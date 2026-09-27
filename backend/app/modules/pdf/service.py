import time
from typing import BinaryIO

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.core.config import get_settings
from app.core.errors import api_error
from app.modules.notes import public as notes
from app.modules.pdf import storage
from app.modules.pdf.jobs import UNFINISHED, expiry, worker
from app.modules.pdf.models import JobKind, JobStatus, PdfJob, SourceType
from app.modules.pdf.schemas import DraftOut, ExportIn, JobOut
from app.modules.reports import public as reports

MAX_UNFINISHED_PER_USER = 10
_PDF_HEADER_WINDOW = 1024  # the %PDF- marker may follow a little leading junk


def _check_queue(db: Session, user_id: int) -> None:
    waiting = db.scalar(
        select(func.count(PdfJob.id)).where(
            PdfJob.created_by == user_id, PdfJob.status.in_(UNFINISHED)
        )
    )
    if (waiting or 0) >= MAX_UNFINISHED_PER_USER:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS, "pdf_queue_full", "Too many PDF jobs waiting"
        )


def _submit(db: Session, job: PdfJob) -> PdfJob:
    db.add(job)
    db.commit()
    db.refresh(job)
    worker.submit(job.id)
    return job


def create_export(db: Session, body: ExportIn, user_id: int) -> PdfJob:
    exists = (
        reports.export_document(db, body.source_id)
        if body.source_type == SourceType.report
        else notes.export_document(db, body.source_id)
    )
    if exists is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "pdf_source_not_found", "Nothing to export")
    _check_queue(db, user_id)
    return _submit(
        db,
        PdfJob(
            kind=JobKind.export,
            created_by=user_id,
            lang=body.lang,
            source_type=body.source_type,
            source_id=body.source_id,
            expires_at=expiry(),
            warnings=[],
        ),
    )


def create_import(db: Session, source: BinaryIO, filename: str, user_id: int) -> PdfJob:
    """Store the upload privately and queue it. Bad files are refused here, before a job."""
    _check_queue(db, user_id)
    limit = get_settings().pdf_import_max_bytes
    try:
        name, size = storage.save_stream(source, limit)
    except storage.TooLarge:
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE, "pdf_too_large", "PDF too large"
        ) from None
    try:
        with storage.path_for(name).open("rb") as fh:
            head = fh.read(_PDF_HEADER_WINDOW)
        if size == 0:
            raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "pdf_empty", "Empty file")
        if b"%PDF-" not in head:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "pdf_unsupported", "Not a PDF file"
            )
        return _submit(
            db,
            PdfJob(
                kind=JobKind.import_,
                created_by=user_id,
                input_name=name,
                original_name=_display_name(filename),
                expires_at=expiry(),
                warnings=[],
            ),
        )
    except BaseException:
        storage.remove(name)
        raise


def _display_name(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    return name[:255] or "document.pdf"


def get_job(db: Session, job_id: int, user_id: int) -> PdfJob:
    job = db.scalar(
        select(PdfJob)
        .options(undefer(PdfJob.draft_md))
        .where(PdfJob.id == job_id, PdfJob.created_by == user_id)
    )
    if job is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "pdf_job_not_found", "Job not found")
    return job


def wait_for_change(db: Session, job_id: int, user_id: int, wait_s: int) -> PdfJob:
    """Long poll: return as soon as the job's status or progress changes, or on timeout."""
    job = get_job(db, job_id, user_id)
    seen = (job.status, job.progress)
    deadline = time.monotonic() + wait_s
    while job.status in UNFINISHED and (remaining := deadline - time.monotonic()) > 0:
        db.rollback()  # hand the connection back to the pool while waiting
        worker.wait(min(remaining, 2.0))  # re-check every 2 s in case a signal was missed
        db.expire_all()
        job = get_job(db, job_id, user_id)
        if (job.status, job.progress) != seen:
            break
    return job


def delete_job(db: Session, job_id: int, user_id: int) -> None:
    """Discard a job and its files now. A running job finishes into nothing."""
    job = get_job(db, job_id, user_id)
    names = (job.input_name, job.result_name)
    db.delete(job)
    db.commit()
    for name in names:
        storage.remove(name)


def to_out(job: PdfJob) -> JobOut:
    draft = None
    if job.kind == JobKind.import_ and job.status == JobStatus.done and job.draft_md is not None:
        draft = DraftOut(title=job.draft_title or "", markdown=job.draft_md)
    return JobOut(
        id=job.id,
        kind=job.kind,
        status=job.status,
        progress=job.progress,
        source_type=job.source_type,
        source_id=job.source_id,
        original_name=job.original_name,
        result_filename=job.result_filename,
        page_count=job.page_count,
        warnings=job.warnings or [],
        error_code=job.error_code,
        created_at=job.created_at,
        finished_at=job.finished_at,
        expires_at=job.expires_at,
        draft=draft,
    )
