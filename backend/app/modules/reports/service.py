import unicodedata
from datetime import UTC, datetime, time, timedelta
from typing import Any, BinaryIO

from fastapi import status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import api_error, field_error
from app.modules.activity.public import record
from app.modules.projects.public import project_exists, project_names
from app.modules.reports import storage, workflow
from app.modules.reports.models import Attachment, Report, ReportStatus, ReportType, Severity
from app.modules.reports.schemas import (
    ReportIn,
    ReportListItem,
    ReportOut,
    ReportPage,
    ReportQuery,
    StatusChangeIn,
)

# info = 0 … critical = 4, so "desc" puts critical first.
_SEVERITY_RANK = case(
    {s.value: i for i, s in enumerate(reversed(list(Severity)))}, value=Report.severity
)
_STATUS_RANK = case({s.value: i for i, s in enumerate(ReportStatus)}, value=Report.status)
_SORT = {
    "updated_at": Report.updated_at,
    "created_at": Report.created_at,
    "submitted_at": Report.submitted_at,
    "severity": _SEVERITY_RANK,  # by rank, not alphabetically
    "status": _STATUS_RANK,  # in workflow order
    "title": func.lower(Report.title),
}
_TRACKED = (
    "project_id",
    "title",
    "type",
    "severity",
    "cvss_score",
    "cvss_vector",
    "body_md",
    "bounty_amount",
    "bounty_currency",
)
_FUTURE_TOLERANCE = timedelta(minutes=5)
_DATE_ORDER = ["submitted_at", "triaged_at", "closed_at", "paid_at"]


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _event(
    db: Session, report: Report, action: str, actor_id: int, details: dict[str, Any]
) -> None:
    record(
        db,
        entity_type="report",
        entity_id=report.id,
        actor_id=actor_id,
        project_id=report.project_id,
        action=action,
        details=details,
    )


# --- reading --------------------------------------------------------------------------


def get_report(db: Session, report_id: int) -> Report:
    report = db.get(Report, report_id)
    if report is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "report_not_found", "Report not found")
    return report


def to_out(db: Session, report: Report) -> ReportOut:
    data = {c: getattr(report, c) for c in ReportOut.model_fields if hasattr(report, c)}
    back = workflow.BACK.get(report.status)
    return ReportOut(
        **data,
        project_name=project_names(db, {report.project_id}).get(report.project_id, ""),
        next_statuses=workflow.allowed_forward(report.status, report.type),
        correction_to=back,
    )


def list_reports(db: Session, q: ReportQuery) -> ReportPage:
    filters = []
    if q.q.strip():
        filters.append(Report.title.ilike(f"%{_escape_like(q.q.strip())}%", escape="\\"))
    for column, value in (
        (Report.project_id, q.project_id),
        (Report.type, q.type),
        (Report.severity, q.severity),
        (Report.status, q.status),
    ):
        if value is not None:
            filters.append(column == value)
    # Whole UTC days; the upper bound is the start of the next day (index-friendly).
    if q.created_from:
        filters.append(Report.created_at >= datetime.combine(q.created_from, time(), UTC))
    if q.created_to:
        next_day = datetime.combine(q.created_to + timedelta(days=1), time(), UTC)
        filters.append(Report.created_at < next_day)

    total = db.scalar(select(func.count(Report.id)).where(*filters)) or 0
    column = _SORT[q.sort]
    ordering = column.asc() if q.order == "asc" else column.desc()
    tiebreak = Report.id.asc() if q.order == "asc" else Report.id.desc()
    # Only the list columns: no Markdown body, no attachments.
    columns = [getattr(Report, f) for f in ReportListItem.model_fields if f != "project_name"]
    rows = db.execute(
        select(*columns)
        .where(*filters)
        .order_by(ordering.nulls_last(), tiebreak)
        .offset((q.page - 1) * q.size)
        .limit(q.size)
    ).all()
    names = project_names(db, {r.project_id for r in rows})
    items = [ReportListItem(**r._asdict(), project_name=names.get(r.project_id, "")) for r in rows]
    return ReportPage(items=items, total=total, page=q.page, size=q.size)


# --- writing ----------------------------------------------------------------------------


def _check_project(db: Session, project_id: int) -> None:
    if not project_exists(db, project_id):
        raise field_error("project_id", "project_not_found", "Project not found")


def create_report(db: Session, data: ReportIn, actor_id: int) -> Report:
    _check_project(db, data.project_id)
    report = Report(**data.model_dump(), status=ReportStatus.draft)
    db.add(report)
    db.flush()
    _event(db, report, "report.created", actor_id, {"title": report.title})
    db.commit()
    db.refresh(report)
    return report


def update_report(db: Session, report_id: int, data: ReportIn, actor_id: int) -> Report:
    report = get_report(db, report_id)
    if data.project_id != report.project_id:
        _check_project(db, data.project_id)
    if report.status == ReportStatus.paid and data.type != ReportType.bbp:
        raise field_error("type", "paid_requires_bbp", "A paid report must stay a BBP report")
    changed = [f for f in _TRACKED if getattr(report, f) != getattr(data, f)]
    if not changed:
        return report
    for field in _TRACKED:
        setattr(report, field, getattr(data, field))
    report.updated_at = func.now()
    _event(db, report, "report.updated", actor_id, {"fields": changed})
    db.commit()
    db.refresh(report)
    return report


def change_status(db: Session, report_id: int, change: StatusChangeIn, actor_id: int) -> Report:
    report = get_report(db, report_id)
    current, target = report.status, change.to
    try:
        workflow.check(current, target, report.type, change.correction)
    except workflow.TransitionError as err:
        raise api_error(
            status.HTTP_409_CONFLICT, err.code, f"Cannot change status {current} → {target}"
        ) from None

    if change.correction:
        # Undo one step: the date of the step being undone is cleared.
        setattr(report, workflow.DATE_FIELD[current], None)
        action, details = "report.status_corrected", {"from": current.value, "to": target.value}
    else:
        now = datetime.now(UTC)
        at = change.at or now
        if at.tzinfo is None:
            raise field_error("at", "timezone_required", "Give the time with a time zone")
        if at > now + _FUTURE_TOLERANCE:
            raise field_error("at", "status_date_in_future", "The date is in the future")
        # Dates follow the workflow: submitted <= triaged <= closed <= paid.
        field = workflow.DATE_FIELD[target]
        earlier = _DATE_ORDER[: _DATE_ORDER.index(field)]
        latest_previous = max(
            (d for d in (getattr(report, f) for f in earlier) if d is not None), default=None
        )
        if latest_previous is not None and at < latest_previous:
            raise field_error("at", "status_date_before_previous", "Earlier than the previous step")
        setattr(report, field, at)
        action, details = "report.status_changed", {"from": current.value, "to": target.value}
        if change.at is not None:
            details["at"] = at.isoformat()

    report.status = target
    report.updated_at = func.now()
    _event(db, report, action, actor_id, details)
    db.commit()
    db.refresh(report)
    return report


def delete_report(db: Session, report_id: int, actor_id: int) -> None:
    report = get_report(db, report_id)
    stored = [a.storage_name for a in report.attachments]
    _event(db, report, "report.deleted", actor_id, {"title": report.title})
    db.delete(report)  # attachment rows cascade
    db.commit()
    # Files go only after the rows are gone: a failure here leaves an orphan file
    # (harmless, logged), never a row pointing at nothing.
    for name in stored:
        storage.remove(name)


# --- evidence ------------------------------------------------------------------------------


def _sanitize_filename(name: str) -> str:
    """Keep only a display name: no directories, no control characters, <= 255 chars."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in unicodedata.normalize("NFC", base) if ch.isprintable())
    base = base.strip()
    if base in ("", ".", ".."):
        base = "file"
    if len(base) > 255:
        ext = storage.extension_of(base)
        base = base[: 254 - len(ext)] + ("." + ext if ext else "")
    return base


def list_attachments(db: Session, report_id: int) -> list[Attachment]:
    return list(get_report(db, report_id).attachments)


def get_attachment(db: Session, report_id: int, attachment_id: int) -> Attachment:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None or attachment.report_id != report_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "attachment_not_found", "Attachment not found")
    return attachment


def add_attachment(
    db: Session, report_id: int, source: BinaryIO, filename: str, actor_id: int
) -> Attachment:
    report = get_report(db, report_id)
    limit = get_settings().max_attachments_per_report
    if len(report.attachments) >= limit:
        raise api_error(status.HTTP_409_CONFLICT, "attachment_limit", "Too many attachments")
    display_name = _sanitize_filename(filename)
    try:
        stored = storage.store(source, display_name)
    except storage.UploadRejected as err:
        raise api_error(err.status_code, err.code, "File rejected") from None

    attachment = Attachment(
        report_id=report.id,
        storage_name=stored.storage_name,
        original_name=display_name,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
    )
    try:
        db.add(attachment)
        db.flush()
        _event(
            db,
            report,
            "report.attachment_added",
            actor_id,
            {"name": display_name, "size": stored.size_bytes},
        )
        db.commit()
    except BaseException:
        # The row did not make it: remove the file so disk and database agree.
        db.rollback()
        storage.remove(stored.storage_name)
        raise
    db.refresh(attachment)
    return attachment


def delete_attachment(db: Session, report_id: int, attachment_id: int, actor_id: int) -> None:
    attachment = get_attachment(db, report_id, attachment_id)
    report = get_report(db, report_id)
    name = attachment.storage_name
    _event(db, report, "report.attachment_deleted", actor_id, {"name": attachment.original_name})
    db.delete(attachment)
    db.commit()
    storage.remove(name)
