from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ErrorBody, api_error, field_error
from app.modules.auth.public import User, require_user
from app.modules.pdf import service, storage
from app.modules.pdf.models import JobKind, JobStatus
from app.modules.pdf.schemas import ExportIn, ImportLimits, JobOut, JobWait

router = APIRouter(
    prefix="/api/pdf",
    tags=["pdf"],
    dependencies=[Depends(require_user)],  # session for all; CSRF + Origin on writes
    responses={code: {"model": ErrorBody} for code in (401, 403, 404, 409, 410, 413, 422, 429)},
)

JobId = Annotated[int, Path(gt=0, le=2_147_483_647)]
CurrentUser = Annotated[User, Depends(require_user)]
Db = Annotated[Session, Depends(get_db)]

_MULTIPART_OVERHEAD = 64 * 1024


@router.get("/limits", response_model=ImportLimits)
def import_limits() -> ImportLimits:
    """The import limits in force, so the UI shows the configured values."""
    settings = get_settings()
    return ImportLimits(
        max_bytes=settings.pdf_import_max_bytes, max_pages=settings.pdf_import_max_pages
    )


@router.post("/exports", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
def create_export(body: ExportIn, user: CurrentUser, db: Db) -> JobOut:
    return service.to_out(service.create_export(db, body, user.id))


@router.post("/imports", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
async def create_import(request: Request, user: CurrentUser, db: Db) -> JobOut:
    """multipart/form-data with one part named "file". Size is bounded before parsing."""
    limit = get_settings().pdf_import_max_bytes
    length = request.headers.get("content-length")
    if length is None or not length.isdigit():
        raise api_error(status.HTTP_411_LENGTH_REQUIRED, "length_required", "Content-Length needed")
    if int(length) > limit + _MULTIPART_OVERHEAD:
        raise api_error(status.HTTP_413_CONTENT_TOO_LARGE, "pdf_too_large", "PDF too large")
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise field_error("file", "missing", "Send the file as multipart/form-data")
    async with request.form(max_files=1, max_fields=0) as form:
        upload = form.get("file")
        if not isinstance(upload, UploadFile) or not upload.filename:
            raise field_error("file", "missing", "No file")
        job = await run_in_threadpool(
            service.create_import, db, upload.file, upload.filename, user.id
        )
    return service.to_out(job)


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: JobId, q: Annotated[JobWait, Query()], user: CurrentUser, db: Db) -> JobOut:
    """The job's state. With ?wait=N the request is held until the job changes (long poll)."""
    return service.to_out(service.wait_for_change(db, job_id, user.id, q.wait))


def _content_disposition(name: str) -> str:
    unsafe = {'"', "\\", ";"}
    fallback = "".join(ch if 32 <= ord(ch) < 127 and ch not in unsafe else "_" for ch in name)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


@router.get("/jobs/{job_id}/download")
def download(job_id: JobId, user: CurrentUser, db: Db) -> Response:
    job = service.get_job(db, job_id, user.id)
    if job.kind != JobKind.export or job.status != JobStatus.done or not job.result_name:
        raise api_error(status.HTTP_409_CONFLICT, "pdf_job_not_ready", "No PDF to download")
    path = storage.path_for(job.result_name)
    if not path.is_file():
        raise api_error(status.HTTP_410_GONE, "pdf_job_expired", "The PDF is no longer available")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": _content_disposition(job.result_filename or "hexops.pdf"),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "no-store",
        },
    )


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: JobId, user: CurrentUser, db: Db) -> Response:
    service.delete_job(db, job_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
