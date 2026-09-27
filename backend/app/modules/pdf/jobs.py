"""The PDF job runner (D-83): one daemon thread in the API process, jobs in PostgreSQL.

- Requests only create a row and hand its id to the worker, so an export or import
  never blocks other API requests. One job runs at a time; the rest wait in order.
- Every status/progress change is committed and announced on `changed`, which the
  long-polling status endpoint waits on (no rapid client polling).
- After a restart, jobs left queued or running are marked failed with
  pdf_job_interrupted and their files deleted (recover_interrupted); the user starts
  them again. Nothing is resumed half-way.
- Finished jobs expire after settings.pdf_result_ttl_minutes: the sweeper deletes the
  row, the draft and any files, plus orphaned or temporary files.
"""

import logging
import queue
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select, update

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.modules.notes import public as notes
from app.modules.pdf import exporter, importer, render, storage
from app.modules.pdf.models import JobKind, JobStatus, PdfJob, SourceType
from app.modules.reports import public as reports

logger = logging.getLogger("hexops")

SWEEP_INTERVAL_SECONDS = 60
UNFINISHED = (JobStatus.queued, JobStatus.running)
FINISHED = (JobStatus.done, JobStatus.failed)


class JobFailed(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def now() -> datetime:
    return datetime.now(UTC)


def expiry() -> datetime:
    return now() + timedelta(minutes=get_settings().pdf_result_ttl_minutes)


class Worker:
    def __init__(self) -> None:
        self._queue: queue.Queue[int] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self.changed = threading.Condition()
        self._last_sweep = 0.0

    def start(self) -> None:
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(
                    target=self._run, name="hexops-pdf-worker", daemon=True
                )
                self._thread.start()

    def submit(self, job_id: int) -> None:
        self.start()
        self._queue.put(job_id)

    def notify(self) -> None:
        with self.changed:
            self.changed.notify_all()

    def wait(self, timeout: float) -> None:
        with self.changed:
            self.changed.wait(timeout)

    def idle(self) -> bool:
        """True when nothing is queued (tests use this to wait for the worker)."""
        return self._queue.unfinished_tasks == 0

    def _run(self) -> None:
        while True:
            try:
                job_id = self._queue.get(timeout=SWEEP_INTERVAL_SECONDS)
            except queue.Empty:
                self._sweep()
                continue
            try:
                run_job(job_id, self.notify)
            except Exception:
                logger.exception("PDF job %s crashed the worker loop", job_id)
            finally:
                self._queue.task_done()
                self.notify()
            if time.monotonic() - self._last_sweep > SWEEP_INTERVAL_SECONDS:
                self._sweep()

    def _sweep(self) -> None:
        self._last_sweep = time.monotonic()
        try:
            sweep_expired()
        except Exception:
            logger.exception("PDF job sweep failed")


worker = Worker()


# --- state changes (each commits and announces itself) -------------------------------------


def _update(job_id: int, notify, **values) -> bool:  # noqa: ANN001
    """Update the row; False when it no longer exists (deleted by the user)."""
    with SessionLocal() as db:
        result = db.execute(update(PdfJob).where(PdfJob.id == job_id).values(**values))
        db.commit()
    notify()
    return result.rowcount == 1


def _fail(job_id: int, code: str, notify) -> None:  # noqa: ANN001
    _update(
        job_id,
        notify,
        status=JobStatus.failed,
        error_code=code,
        finished_at=now(),
        expires_at=expiry(),
    )


def run_job(job_id: int, notify=lambda: None) -> None:  # noqa: ANN001
    with SessionLocal() as db:
        job = db.get(PdfJob, job_id)
        if job is None or job.status != JobStatus.queued:
            return  # deleted, or already handled (e.g. interrupted)
        kind, lang = job.kind, job.lang
        source = (job.source_type, job.source_id)
        input_name, original_name = job.input_name, job.original_name
    _update(job_id, notify, status=JobStatus.running, started_at=now(), progress=5)
    try:
        if kind == JobKind.export:
            _export(job_id, lang, source[0], source[1], notify)
        else:
            _import(job_id, input_name, original_name, notify)
    except (JobFailed, exporter.ExportFailed, importer.ImportFailed) as exc:
        _fail(job_id, exc.code, notify)
    except Exception:
        # No document content in the log: only the job and the exception type/trace.
        logger.exception("PDF %s job %s failed", kind.value, job_id)
        _fail(job_id, f"pdf_{kind.value}_failed", notify)
    finally:
        storage.remove(input_name)  # the upload is never kept once read


def _export(job_id: int, lang: str, source_type, source_id, notify) -> None:  # noqa: ANN001
    with SessionLocal() as db:
        if source_type == SourceType.report:
            doc = reports.export_document(db, source_id)
        else:
            doc = notes.export_document(db, source_id)
    if doc is None:
        raise JobFailed("pdf_source_not_found")
    _update(job_id, notify, progress=20)
    exported_at = now()
    pdf = exporter.html_to_pdf(
        render.document_html(doc, lang), lang, exported_at, get_settings().pdf_job_timeout_seconds
    )
    _update(job_id, notify, progress=90)
    name = storage.save_bytes(pdf)
    finished = _update(
        job_id,
        notify,
        status=JobStatus.done,
        progress=100,
        result_name=name,
        result_filename=download_name(doc.title),
        finished_at=now(),
        expires_at=expiry(),
    )
    if not finished:
        storage.remove(name)  # the job was deleted while it ran


def _import(job_id: int, input_name, original_name, notify) -> None:  # noqa: ANN001
    settings = get_settings()
    last = [0]

    def progress(value: int) -> None:
        if value - last[0] >= 5:  # a commit per 5 %, not per page
            last[0] = value
            _update(job_id, notify, progress=value)

    draft = importer.extract(
        storage.path_for(input_name),
        settings.pdf_import_max_pages,
        time.monotonic() + settings.pdf_job_timeout_seconds,
        progress,
    )
    _update(
        job_id,
        notify,
        status=JobStatus.done,
        progress=100,
        input_name=None,
        draft_title=(draft.title or Path(original_name or "").stem or "PDF")[:300],
        draft_md=draft.markdown,
        page_count=draft.page_count,
        warnings=draft.warnings,
        finished_at=now(),
        expires_at=expiry(),
    )


def download_name(title: str) -> str:
    """A readable file name: the title without path or control characters."""
    cleaned = "".join(ch if ch.isprintable() and ch not in '/\\:*?"<>|' else " " for ch in title)
    cleaned = " ".join(cleaned.split()).strip(" .")[:120]
    return f"{cleaned or 'hexops'}.pdf"


# --- startup and expiry -------------------------------------------------------------------


def recover_interrupted() -> int:
    """Fail jobs a previous process left unfinished. Run once at startup."""
    with SessionLocal() as db:
        rows = db.execute(
            update(PdfJob)
            .where(PdfJob.status.in_(UNFINISHED))
            .values(
                status=JobStatus.failed,
                error_code="pdf_job_interrupted",
                input_name=None,
                finished_at=now(),
                expires_at=expiry(),
            )
            .returning(PdfJob.id)
        ).all()
        db.commit()
    if rows:
        logger.warning("Marked %d interrupted PDF job(s) as failed", len(rows))
    # Their uploads are no longer referenced, so the orphan sweep removes them.
    storage.sweep_orphans(_referenced_files(), older_than_seconds=0)
    return len(rows)


def _referenced_files() -> set[str]:
    with SessionLocal() as db:
        rows = db.execute(select(PdfJob.input_name, PdfJob.result_name)).all()
    return {name for row in rows for name in row if name}


def sweep_expired() -> int:
    """Delete finished jobs past their expiry, with their files. Returns how many."""
    with SessionLocal() as db:
        rows = db.execute(
            delete(PdfJob)
            .where(PdfJob.status.in_(FINISHED), PdfJob.expires_at < now())
            .returning(PdfJob.input_name, PdfJob.result_name)
        ).all()
        db.commit()
    for input_name, result_name in rows:
        storage.remove(input_name)
        storage.remove(result_name)
    storage.sweep_orphans(_referenced_files())
    return len(rows)
