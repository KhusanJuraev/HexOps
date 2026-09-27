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
from app.modules.reports import service, storage
from app.modules.reports.schemas import (
    AttachmentOut,
    EvidenceLimits,
    ReportIn,
    ReportOut,
    ReportPage,
    ReportQuery,
    StatusChangeIn,
)

router = APIRouter(
    prefix="/api/reports",
    tags=["reports"],
    dependencies=[Depends(require_user)],  # session for all; CSRF + Origin on writes
    responses={code: {"model": ErrorBody} for code in (401, 403, 404, 409, 413, 422)},
)

ReportId = Annotated[int, Path(gt=0, le=2_147_483_647)]
AttachmentId = Annotated[int, Path(gt=0, le=2_147_483_647)]
CurrentUser = Annotated[User, Depends(require_user)]
Db = Annotated[Session, Depends(get_db)]

# Multipart framing around the file: boundaries, part headers, the file name.
_MULTIPART_OVERHEAD = 64 * 1024


@router.get("", response_model=ReportPage)
def list_reports(q: Annotated[ReportQuery, Query()], db: Db) -> ReportPage:
    return service.list_reports(db, q)


@router.post("", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def create_report(body: ReportIn, user: CurrentUser, db: Db) -> ReportOut:
    return service.to_out(db, service.create_report(db, body, user.id))


@router.get("/evidence-limits", response_model=EvidenceLimits)
def evidence_limits() -> EvidenceLimits:
    """The evidence limits in force (declared before /{report_id} so it matches first)."""
    settings = get_settings()
    return EvidenceLimits(
        max_bytes=settings.max_upload_bytes, max_files=settings.max_attachments_per_report
    )


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: ReportId, db: Db) -> ReportOut:
    return service.to_out(db, service.get_report(db, report_id))


@router.put("/{report_id}", response_model=ReportOut)
def update_report(report_id: ReportId, body: ReportIn, user: CurrentUser, db: Db) -> ReportOut:
    return service.to_out(db, service.update_report(db, report_id, body, user.id))


@router.post("/{report_id}/status", response_model=ReportOut)
def change_status(
    report_id: ReportId, body: StatusChangeIn, user: CurrentUser, db: Db
) -> ReportOut:
    return service.to_out(db, service.change_status(db, report_id, body, user.id))


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(report_id: ReportId, user: CurrentUser, db: Db) -> Response:
    service.delete_report(db, report_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- evidence ------------------------------------------------------------------------------


@router.get("/{report_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(report_id: ReportId, db: Db) -> list[AttachmentOut]:
    return [AttachmentOut.model_validate(a) for a in service.list_attachments(db, report_id)]


@router.post(
    "/{report_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED
)
async def upload_attachment(
    report_id: ReportId, request: Request, user: CurrentUser, db: Db
) -> AttachmentOut:
    """multipart/form-data with one part named "file".

    The size is bounded before anything is parsed: without a Content-Length the
    request is refused, and an oversized one never reaches the multipart parser.
    """
    length = request.headers.get("content-length")
    if length is None or not length.isdigit():
        raise api_error(status.HTTP_411_LENGTH_REQUIRED, "length_required", "Content-Length needed")
    if int(length) > get_settings().max_upload_bytes + _MULTIPART_OVERHEAD:
        raise api_error(status.HTTP_413_CONTENT_TOO_LARGE, "attachment_too_large", "File too large")
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise field_error("file", "missing", "Send the file as multipart/form-data")
    async with request.form(max_files=1, max_fields=0) as form:
        upload = form.get("file")
        if not isinstance(upload, UploadFile) or not upload.filename:
            raise field_error("file", "missing", "No file")
        attachment = await run_in_threadpool(
            service.add_attachment, db, report_id, upload.file, upload.filename, user.id
        )
    return AttachmentOut.model_validate(attachment)


def _content_disposition(name: str) -> str:
    """attachment; ASCII fallback plus the exact UTF-8 name (RFC 6266 / 5987)."""
    unsafe = {'"', "\\", ";"}
    fallback = "".join(ch if 32 <= ord(ch) < 127 and ch not in unsafe else "_" for ch in name)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


@router.get("/{report_id}/attachments/{attachment_id}/download")
def download_attachment(report_id: ReportId, attachment_id: AttachmentId, db: Db) -> Response:
    attachment = service.get_attachment(db, report_id, attachment_id)
    path = storage.path_for(attachment.storage_name)
    if not path.is_file():
        raise api_error(status.HTTP_410_GONE, "attachment_file_missing", "File is missing")
    return FileResponse(
        path,
        media_type=attachment.content_type,
        headers={
            # Always a download, never rendered: even a text/HTML PoC or an image.
            "Content-Disposition": _content_disposition(attachment.original_name),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "no-store",
        },
    )


@router.delete("/{report_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    report_id: ReportId, attachment_id: AttachmentId, user: CurrentUser, db: Db
) -> Response:
    service.delete_attachment(db, report_id, attachment_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
