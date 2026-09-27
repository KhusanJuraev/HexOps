import time
from typing import BinaryIO

from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import maintenance
from app.core.config import get_settings
from app.core.errors import api_error
from app.modules.transfer import container, storage
from app.modules.transfer.jobs import Task, current_counts, expiry, worker
from app.modules.transfer.models import TransferJob, TransferKind, TransferStatus
from app.modules.transfer.schemas import JobOut, StateOut

UNFINISHED = (TransferStatus.queued, TransferStatus.running)


def _busy(db: Session) -> bool:
    running = db.scalar(select(TransferJob.id).where(TransferJob.status.in_(UNFINISHED)).limit(1))
    return running is not None or maintenance.active() is not None


def _refuse_if_busy(db: Session) -> None:
    if _busy(db):
        raise api_error(
            status.HTTP_409_CONFLICT, "transfer_busy", "Another export or import is running"
        )


def state(db: Session) -> StateOut:
    counts = current_counts(db)
    return StateOut(
        counts=counts,
        populated=any(counts.values()),
        busy=_busy(db),
        max_archive_bytes=get_settings().transfer_max_archive_bytes,
    )


def create_export(db: Session, passphrase: str, user_id: int) -> TransferJob:
    _refuse_if_busy(db)
    job = TransferJob(
        kind=TransferKind.export, created_by=user_id, stage="queued", expires_at=expiry()
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    worker.submit(Task(job.id, "export", passphrase))
    return job


def create_import(
    db: Session, source: BinaryIO, filename: str, passphrase: str, user_id: int
) -> TransferJob:
    """Store the encrypted upload privately and check it. Live data is not touched."""
    _refuse_if_busy(db)
    try:
        name, size, head = storage.save_stream(source, get_settings().transfer_max_archive_bytes)
    except storage.TooLarge:
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE, "transfer_too_large", "Archive too large"
        ) from None
    if head != container.MAGIC:
        storage.remove(name)
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "transfer_not_hexops", "Not a .hexops archive"
        )
    display = "".join(
        ch for ch in filename.replace("\\", "/").rsplit("/", 1)[-1] if ch.isprintable()
    )[:255]
    job = TransferJob(
        kind=TransferKind.import_,
        created_by=user_id,
        archive_name=name,
        archive_size=size,
        original_name=display or "archive.hexops",
        expires_at=expiry(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    worker.submit(Task(job.id, "check", passphrase))
    return job


def get_job(db: Session, job_id: int, user_id: int) -> TransferJob:
    job = db.scalar(
        select(TransferJob).where(TransferJob.id == job_id, TransferJob.created_by == user_id)
    )
    if job is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "transfer_job_not_found", "Job not found")
    return job


def recheck(db: Session, job_id: int, passphrase: str, user_id: int) -> TransferJob:
    """Check an uploaded archive again, e.g. after a mistyped passphrase."""
    job = get_job(db, job_id, user_id)
    if (
        job.kind != TransferKind.import_
        or job.status != TransferStatus.failed
        or not job.archive_name
    ):
        raise api_error(
            status.HTTP_409_CONFLICT, "transfer_job_not_ready", "Nothing to check again"
        )
    _refuse_if_busy(db)
    job.status, job.stage, job.progress, job.error_code, job.error_detail = (
        TransferStatus.queued,
        "queued",
        0,
        None,
        None,
    )
    job.expires_at = expiry()
    db.commit()
    worker.submit(Task(job.id, "check", passphrase))
    return job


def apply(db: Session, job_id: int, passphrase: str, replace: bool, user_id: int) -> TransferJob:
    job = get_job(db, job_id, user_id)
    if (
        job.kind != TransferKind.import_
        or job.status != TransferStatus.validated
        or not job.archive_name
    ):
        raise api_error(
            status.HTTP_409_CONFLICT, "transfer_job_not_ready", "Check the archive first"
        )
    _refuse_if_busy(db)
    if any(current_counts(db).values()) and not replace:
        # Never merged, never overwritten silently: replacing data needs an explicit yes.
        raise api_error(
            status.HTTP_409_CONFLICT, "transfer_confirmation_required", "Confirm replacing data"
        )
    job.status, job.stage, job.progress = TransferStatus.queued, "queued", 0
    job.expires_at = expiry()
    db.commit()
    worker.submit(Task(job.id, "apply", passphrase, replace=replace))
    return job


def wait_for_change(db: Session, job_id: int, user_id: int, wait_s: int) -> TransferJob:
    job = get_job(db, job_id, user_id)
    seen = (job.status, job.stage, job.progress)
    deadline = time.monotonic() + wait_s
    while job.status in UNFINISHED and (remaining := deadline - time.monotonic()) > 0:
        db.rollback()
        worker.wait(min(remaining, 2.0))
        db.expire_all()
        job = get_job(db, job_id, user_id)
        if (job.status, job.stage, job.progress) != seen:
            break
    return job


def delete_job(db: Session, job_id: int, user_id: int) -> None:
    job = get_job(db, job_id, user_id)
    if job.status in UNFINISHED:
        raise api_error(status.HTTP_409_CONFLICT, "transfer_busy", "The job is running")
    name = job.archive_name
    db.delete(job)
    db.commit()
    storage.remove(name)


def download_name(job: TransferJob) -> str | None:
    if job.kind != TransferKind.export or job.status != TransferStatus.done or not job.archive_name:
        return None
    return f"hexops-{job.created_at:%Y%m%d-%H%M}.hexops"


def to_out(job: TransferJob) -> JobOut:
    return JobOut(
        id=job.id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        archive_size=job.archive_size,
        original_name=job.original_name,
        preview=job.preview,
        backup_name=job.backup_name,
        error_code=job.error_code,
        created_at=job.created_at,
        finished_at=job.finished_at,
        expires_at=job.expires_at,
        download_name=download_name(job),
    )
