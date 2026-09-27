"""Full-data export and import jobs (D-90): one worker thread, one job at a time.

Export   maintenance on (writes refused, in-flight writes drained) → REPEATABLE READ
         read-only snapshot → rows and evidence files streamed into the encrypted
         archive → maintenance off.
Import   1. check: decrypt to a private temp ZIP, `archive.inspect` everything, store a
            preview (counts, sizes, disk space). Live data untouched.
         2. apply (owner confirmed; passphrase given again):
            maintenance on → if the instance has data: write a pre-import backup with
            the same passphrase and verify it by reading it back → decrypt and inspect
            the import again → stage evidence files in a new directory → one database
            transaction replaces every data table (and marks the job done) → the
            uploads directory is swapped just before COMMIT → old files removed.
            Any failure before COMMIT leaves the database and files exactly as they
            were. A crash between the swap and COMMIT is repaired at the next start
            from the marker file (`recover_interrupted`).

The passphrase is passed to the worker in memory only; it is never stored or logged.
"""

import importlib.metadata
import json
import logging
import os
import queue
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select, text, update

from app.core import maintenance
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.modules.auth.public import User
from app.modules.transfer import archive, container, storage
from app.modules.transfer.models import TransferJob, TransferKind, TransferStatus
from app.modules.transfer.tables import DATA_TABLES, SERIAL_TABLES, table

logger = logging.getLogger("hexops")

SWEEP_INTERVAL_SECONDS = 300
UNFINISHED = (TransferStatus.queued, TransferStatus.running)


class JobFailed(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


def now() -> datetime:
    return datetime.now(UTC)


def expiry() -> datetime:
    return now() + timedelta(minutes=get_settings().transfer_result_ttl_minutes)


def app_version() -> str:
    try:
        return importlib.metadata.version("hexops-backend")
    except importlib.metadata.PackageNotFoundError:
        return "0.1.0"


def limits() -> archive.Limits:
    s = get_settings()
    return archive.Limits(
        max_entries=s.transfer_max_entries, max_unpacked_bytes=s.transfer_max_unpacked_bytes
    )


@dataclass
class Task:
    job_id: int
    action: str  # "export" | "check" | "apply"
    passphrase: str
    replace: bool = False


class Worker:
    def __init__(self) -> None:
        self._queue: queue.Queue[Task] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self.changed = threading.Condition()
        self._last_sweep = 0.0

    def start(self) -> None:
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(
                    target=self._run, name="hexops-transfer-worker", daemon=True
                )
                self._thread.start()

    def submit(self, task: Task) -> None:
        self.start()
        self._queue.put(task)

    def notify(self) -> None:
        with self.changed:
            self.changed.notify_all()

    def wait(self, timeout: float) -> None:
        with self.changed:
            self.changed.wait(timeout)

    def idle(self) -> bool:
        return self._queue.unfinished_tasks == 0

    def _run(self) -> None:
        while True:
            try:
                task = self._queue.get(timeout=SWEEP_INTERVAL_SECONDS)
            except queue.Empty:
                self._sweep()
                continue
            try:
                run(task, self.notify)
            except Exception:
                logger.exception("Transfer job %s crashed the worker loop", task.job_id)
            finally:
                task.passphrase = ""  # drop our reference as soon as possible
                self._queue.task_done()
                self.notify()
            if time.monotonic() - self._last_sweep > SWEEP_INTERVAL_SECONDS:
                self._sweep()

    def _sweep(self) -> None:
        self._last_sweep = time.monotonic()
        try:
            sweep_expired()
        except Exception:
            logger.exception("Transfer sweep failed")


worker = Worker()


# --- state ---------------------------------------------------------------------------------


def _update(job_id: int, notify, **values) -> None:  # noqa: ANN001
    with SessionLocal() as db:
        db.execute(update(TransferJob).where(TransferJob.id == job_id).values(**values))
        db.commit()
    notify()


def _progress(job_id: int, notify, stage: str):  # noqa: ANN001, ANN202
    last = [-10]

    def report(value: int) -> None:
        if value - last[0] >= 5 or value >= 100:
            last[0] = value
            _update(job_id, notify, stage=stage, progress=min(value, 99))

    return report


def current_counts(db) -> dict[str, int]:  # noqa: ANN001
    return {
        name: db.scalar(select(func.count()).select_from(table(name))) or 0 for name in DATA_TABLES
    }


def run(task: Task, notify=lambda: None) -> None:  # noqa: ANN001
    with SessionLocal() as db:
        job = db.get(TransferJob, task.job_id)
        if job is None or job.status != TransferStatus.queued:
            return
        kind, archive_name, created_by = job.kind, job.archive_name, job.created_by
    _update(
        task.job_id,
        notify,
        status=TransferStatus.running,
        started_at=now(),
        progress=1,
        error_code=None,
    )
    try:
        if task.action == "export":
            _export(task, created_by, notify)
        elif task.action == "check":
            _check(task, archive_name, notify)
        else:
            _apply(task, archive_name, created_by, notify)
    except (JobFailed, archive.ArchiveError, container.ContainerError) as exc:
        detail = getattr(exc, "detail", "")[:255] or None
        # An import that failed its check or apply keeps its archive for 1 hour so the
        # owner can retry (e.g. a mistyped passphrase); nothing else is kept.
        _update(
            task.job_id,
            notify,
            status=TransferStatus.failed,
            error_code=exc.code,
            error_detail=detail,
            finished_at=now(),
            expires_at=expiry(),
        )
    except Exception:
        logger.exception("Transfer %s job %s failed", kind.value, task.job_id)
        _update(
            task.job_id,
            notify,
            status=TransferStatus.failed,
            error_code=f"transfer_{task.action}_failed",
            finished_at=now(),
            expires_at=expiry(),
        )


# --- export ----------------------------------------------------------------------------------


def write_archive(passphrase: str, owner_id: int, progress) -> tuple[Path, dict[str, Any]]:  # noqa: ANN001
    """Snapshot everything into a new encrypted temp file. Caller holds maintenance."""
    tmp = storage.new_temp()
    try:
        with SessionLocal() as db:
            db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
            db.execute(text("SET TRANSACTION READ ONLY"))
            owner = db.get(User, owner_id)
            with tmp.open("wb") as out:
                writer = container.EncryptingWriter(out, passphrase)
                manifest = archive.write(
                    db, writer, owner.username if owner else "", app_version(), progress
                )
                writer.close()
                os.fsync(out.fileno())
            db.rollback()
        return tmp, manifest
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _summary(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "created_at": manifest["created_at"],
        "app_version": manifest["app_version"],
        "schema_version": manifest["schema_version"],
        "counts": {name: meta["rows"] for name, meta in manifest["tables"].items()},
        "files": manifest["totals"]["files"],
        "file_bytes": manifest["totals"]["file_bytes"],
    }


def _export(task: Task, owner_id: int, notify) -> None:  # noqa: ANN001
    if not maintenance.begin("export"):
        raise JobFailed("transfer_busy")
    try:
        tmp, manifest = write_archive(
            task.passphrase, owner_id, _progress(task.job_id, notify, "export")
        )
    finally:
        maintenance.end()
    size = tmp.stat().st_size
    name = storage.publish(tmp)
    _update(
        task.job_id,
        notify,
        status=TransferStatus.done,
        stage="done",
        progress=100,
        archive_name=name,
        archive_size=size,
        preview={"source": _summary(manifest)},
        finished_at=now(),
        expires_at=expiry(),
    )


# --- import ---------------------------------------------------------------------------------


def _decrypt(archive_path: Path, passphrase: str) -> Path:
    """Decrypt into a private temp ZIP; the caller deletes it."""
    plain = storage.new_temp(storage.PLAIN_PREFIX)
    limit = get_settings().transfer_max_archive_bytes
    size = 0
    try:
        with archive_path.open("rb") as src, plain.open("wb") as out:
            for chunk in container.open_container(src, passphrase):
                size += len(chunk)
                if size > limit:
                    raise JobFailed("transfer_too_large")
                out.write(chunk)
        return plain
    except BaseException:
        plain.unlink(missing_ok=True)
        raise


def _inspect(archive_name: str | None, passphrase: str, progress) -> tuple[Path, archive.Package]:  # noqa: ANN001
    if not archive_name:
        raise JobFailed("transfer_archive_missing")
    plain = _decrypt(storage.path_for(archive_name), passphrase)
    try:
        with SessionLocal() as db:
            schema = archive.schema_version(db)
        return plain, archive.inspect(plain, schema, limits(), progress)
    except BaseException:
        plain.unlink(missing_ok=True)
        raise


def _space(package: archive.Package, archive_size: int, populated: bool) -> tuple[int, int]:
    """(bytes needed, bytes free): staged evidence + a decrypted copy + a backup if needed."""
    settings = get_settings()
    needed = sum(f["size"] for f in package.files.values()) + archive_size * 2
    if populated:
        needed += storage.tree_size(settings.uploads_dir) + archive_size
    return needed, storage.free_bytes(settings.uploads_dir.parent)


def _check(task: Task, archive_name: str | None, notify) -> None:  # noqa: ANN001
    plain, package = _inspect(
        archive_name, task.passphrase, _progress(task.job_id, notify, "check")
    )
    plain.unlink(missing_ok=True)
    with SessionLocal() as db:
        target = current_counts(db)
    populated = any(target.values())
    size = storage.path_for(archive_name).stat().st_size  # type: ignore[arg-type]
    needed, free = _space(package, size, populated)
    preview = {
        "source": _summary(package.manifest)
        | {"source_owner": package.manifest.get("source_owner", "")},
        "target": {"counts": target, "populated": populated},
        "space": {"needed_bytes": needed, "free_bytes": free},
    }
    _update(
        task.job_id,
        notify,
        status=TransferStatus.validated,
        stage="validated",
        progress=100,
        preview=preview,
        finished_at=now(),
        expires_at=expiry(),
    )


def _backup(passphrase: str, owner_id: int, job_id: int, notify) -> str:  # noqa: ANN001
    """Write and verify a pre-import backup of the current data. Returns its file name."""
    tmp, _manifest = write_archive(passphrase, owner_id, _progress(job_id, notify, "backup"))
    stamp = now().strftime("%Y%m%d-%H%M%S")
    name = f"pre-import-{stamp}-job{job_id}.hexops"
    dest = storage.backups_dir() / name
    os.replace(tmp, dest)
    dest.chmod(0o600)
    # Verify by reading it back exactly as an import would (decrypt + full inspection).
    plain = _decrypt(dest, passphrase)
    try:
        with SessionLocal() as db:
            schema = archive.schema_version(db)
        archive.inspect(plain, schema, limits(), lambda _p: None)
    except (archive.ArchiveError, container.ContainerError) as exc:
        raise JobFailed("transfer_backup_failed", getattr(exc, "code", "")) from None
    finally:
        plain.unlink(missing_ok=True)
    return name


def _marker(job_id: int) -> Path:
    return storage.transfer_dir() / f"import-{job_id}.swap.json"


def _replace_rows(db, package: archive.Package, importer_id: int) -> None:  # noqa: ANN001
    for name in reversed(DATA_TABLES):
        db.execute(delete(table(name)))
    db.execute(text("DELETE FROM pdf_jobs"))  # temporary results about the old records
    for name in DATA_TABLES:
        rows = package.rows[name]
        if name == "activity_logs":  # history belongs to this installation's owner now
            rows = [
                r | {"actor_user_id": importer_id if r["actor_user_id"] is not None else None}
                for r in rows
            ]
        for start in range(0, len(rows), 1000):
            db.execute(table(name).insert(), rows[start : start + 1000])
    for name in SERIAL_TABLES:
        db.execute(
            text(
                f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "  # noqa: S608 - fixed names
                f"COALESCE((SELECT max(id) FROM {name}), 1), (SELECT count(*) > 0 FROM {name}))"
            )
        )


def _apply(task: Task, archive_name: str | None, importer_id: int, notify) -> None:  # noqa: ANN001
    uploads = get_settings().uploads_dir
    uploads.mkdir(mode=0o700, parents=True, exist_ok=True)
    staging = uploads.parent / f".uploads-import-{task.job_id}"
    previous = uploads.parent / f".uploads-pre-import-{task.job_id}"
    marker = _marker(task.job_id)
    if not maintenance.begin("import"):
        raise JobFailed("transfer_busy")
    plain: Path | None = None
    swapped = False
    try:
        with SessionLocal() as db:
            populated = any(current_counts(db).values())
        if populated and not task.replace:
            raise JobFailed("transfer_confirmation_required")
        backup = _backup(task.passphrase, importer_id, task.job_id, notify) if populated else None
        if backup:
            _update(task.job_id, notify, backup_name=backup)

        plain, package = _inspect(
            archive_name, task.passphrase, _progress(task.job_id, notify, "check")
        )
        needed, free = _space(package, plain.stat().st_size, False)
        if needed > free:
            raise JobFailed("transfer_no_space")

        _update(task.job_id, notify, stage="files", progress=60)
        storage.remove_tree(staging)
        staging.mkdir(mode=0o700)
        archive.extract_files(plain, package.files, staging)

        _update(task.job_id, notify, stage="database", progress=80)
        with SessionLocal() as db:
            _replace_rows(db, package, importer_id)
            db.execute(
                update(TransferJob)
                .where(TransferJob.id == task.job_id)
                .values(
                    status=TransferStatus.done,
                    stage="done",
                    progress=100,
                    finished_at=now(),
                    expires_at=expiry(),
                )
            )
            db.flush()
            # Swap the evidence directory just before COMMIT; the marker lets a restart
            # finish or undo the swap depending on whether COMMIT happened.
            marker.write_text(
                json.dumps(
                    {"uploads": str(uploads), "staging": str(staging), "previous": str(previous)}
                )
            )
            os.replace(uploads, previous)
            os.replace(staging, uploads)
            swapped = True
            try:
                db.commit()
            except BaseException:
                os.replace(uploads, staging)
                os.replace(previous, uploads)
                swapped = False
                raise
        storage.remove_tree(previous)
        marker.unlink(missing_ok=True)
        storage.remove(archive_name)  # the uploaded archive is not kept once applied
        _update(task.job_id, notify, archive_name=None)
    except BaseException:
        if not swapped:
            storage.remove_tree(staging)
            marker.unlink(missing_ok=True)
        raise
    finally:
        if plain is not None:
            plain.unlink(missing_ok=True)
        maintenance.end()


# --- startup and expiry --------------------------------------------------------------------


def recover_interrupted() -> int:
    """Run once at startup: finish or undo a half-done directory swap, fail stale jobs."""
    for marker in storage.transfer_dir().glob("import-*.swap.json"):
        job_id = int(marker.name.split("-")[1].split(".")[0])
        paths = {k: Path(v) for k, v in json.loads(marker.read_text()).items()}
        with SessionLocal() as db:
            job = db.get(TransferJob, job_id)
            committed = job is not None and job.status == TransferStatus.done
        if committed:  # the new data is in the database: keep the new files
            storage.remove_tree(paths["previous"])
        elif paths["previous"].exists():  # COMMIT never happened: put the old files back
            if paths["uploads"].exists():
                os.replace(paths["uploads"], paths["staging"])
            os.replace(paths["previous"], paths["uploads"])
        storage.remove_tree(paths["staging"])
        marker.unlink()
        logger.warning("Recovered an interrupted import (job %s, committed=%s)", job_id, committed)
    for staging in get_settings().uploads_dir.parent.glob(".uploads-import-*"):
        storage.remove_tree(staging)
    storage.sweep_temp()
    with SessionLocal() as db:
        rows = db.execute(
            update(TransferJob)
            .where(TransferJob.status.in_(UNFINISHED))
            .values(
                status=TransferStatus.failed,
                error_code="transfer_job_interrupted",
                finished_at=now(),
                expires_at=expiry(),
            )
            .returning(TransferJob.id)
        ).all()
        db.commit()
    return len(rows)


def sweep_expired() -> int:
    """Delete expired jobs and their archives (never the pre-import backups)."""
    with SessionLocal() as db:
        rows = db.execute(
            delete(TransferJob)
            .where(TransferJob.status.not_in(UNFINISHED), TransferJob.expires_at < now())
            .returning(TransferJob.archive_name)
        ).all()
        db.commit()
    for (name,) in rows:
        storage.remove(name)
    return len(rows)


__all__ = ["JobFailed", "Task", "TransferKind", "worker"]
