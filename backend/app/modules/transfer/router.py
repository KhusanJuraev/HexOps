from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ErrorBody, api_error, field_error
from app.modules.auth.public import User, require_user
from app.modules.transfer import service, storage
from app.modules.transfer.schemas import ApplyIn, CheckIn, ExportIn, JobOut, JobWait, StateOut

router = APIRouter(
    prefix="/api/transfer",
    tags=["transfer"],
    dependencies=[Depends(require_user)],  # session for all; CSRF + Origin on writes
    responses={code: {"model": ErrorBody} for code in (401, 403, 404, 409, 410, 413, 422)},
)

JobId = Annotated[int, Path(gt=0, le=2_147_483_647)]
CurrentUser = Annotated[User, Depends(require_user)]
Db = Annotated[Session, Depends(get_db)]
_MULTIPART_OVERHEAD = 64 * 1024


@router.get("/state", response_model=StateOut)
def get_state(db: Db) -> StateOut:
    return service.state(db)


@router.post("/exports", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
def create_export(body: ExportIn, user: CurrentUser, db: Db) -> JobOut:
    return service.to_out(service.create_export(db, body.passphrase, user.id))


@router.post("/imports", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
async def create_import(request: Request, user: CurrentUser, db: Db) -> JobOut:
    """multipart/form-data: "file" (the .hexops archive) and "passphrase"."""
    limit = get_settings().transfer_max_archive_bytes
    length = request.headers.get("content-length")
    if length is None or not length.isdigit():
        raise api_error(status.HTTP_411_LENGTH_REQUIRED, "length_required", "Content-Length needed")
    if int(length) > limit + _MULTIPART_OVERHEAD:
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE, "transfer_too_large", "Archive too large"
        )
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise field_error("file", "missing", "Send the archive as multipart/form-data")
    async with request.form(max_files=1, max_fields=1, max_part_size=4096) as form:
        upload, passphrase = form.get("file"), form.get("passphrase")
        if not isinstance(upload, UploadFile) or not upload.filename:
            raise field_error("file", "missing", "No file")
        if not isinstance(passphrase, str) or not 12 <= len(passphrase) <= 1024:
            raise field_error("passphrase", "passphrase_too_short", "At least 12 characters")
        job = await run_in_threadpool(
            service.create_import, db, upload.file, upload.filename, passphrase, user.id
        )
    return service.to_out(job)


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: JobId, q: Annotated[JobWait, Query()], user: CurrentUser, db: Db) -> JobOut:
    return service.to_out(service.wait_for_change(db, job_id, user.id, q.wait))


@router.post("/jobs/{job_id}/check", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
def check_again(job_id: JobId, body: CheckIn, user: CurrentUser, db: Db) -> JobOut:
    return service.to_out(service.recheck(db, job_id, body.passphrase, user.id))


@router.post("/jobs/{job_id}/apply", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
def apply(job_id: JobId, body: ApplyIn, user: CurrentUser, db: Db) -> JobOut:
    return service.to_out(service.apply(db, job_id, body.passphrase, body.replace, user.id))


@router.get("/jobs/{job_id}/download")
def download(job_id: JobId, user: CurrentUser, db: Db) -> Response:
    job = service.get_job(db, job_id, user.id)
    name = service.download_name(job)
    if name is None:
        raise api_error(
            status.HTTP_409_CONFLICT, "transfer_job_not_ready", "No archive to download"
        )
    path = storage.path_for(job.archive_name)  # type: ignore[arg-type]
    if not path.is_file():
        raise api_error(
            status.HTTP_410_GONE, "transfer_job_expired", "The archive is no longer available"
        )
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={
            # name is ours (hexops-YYYYmmdd-HHMM.hexops): plain ASCII, no quoting issues
            "Content-Disposition": f'attachment; filename="{name}"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "no-store",
        },
    )


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: JobId, user: CurrentUser, db: Db) -> Response:
    service.delete_job(db, job_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
