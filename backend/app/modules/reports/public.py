"""The reports module's public interface. Other modules import only from here.

Used by search and the dashboard (Stage 6) and PDF export (Stage 7). Read-only.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Select, func, literal, select
from sqlalchemy.orm import Session

from app.core.export import ExportDocument
from app.core.textsearch import ParsedQuery, SearchDetail, match
from app.modules.projects.public import project_names
from app.modules.reports.models import Report, ReportStatus, ReportType, Severity
from app.modules.reports.storage import path_for

__all__ = [
    "ExportDocument",
    "SearchDetail",
    "count_by_severity",
    "count_by_status",
    "created_per_month",
    "evidence_path",
    "export_document",
    "PaidMonth",
    "paid_per_month",
    "UnpaidTotal",
    "unpaid_bounties",
    "search_details",
    "search_select",
    "total",
]


# --- search -------------------------------------------------------------------------


def search_select(parsed: ParsedQuery) -> Select:
    """Matching reports as (kind, id, rank, updated_at), for a UNION with other kinds."""
    condition, rank = match(parsed, Report.search_vector, Report.title, Report.body_md)
    return select(
        literal("report").label("kind"),
        Report.id.label("id"),
        rank.label("rank"),
        Report.updated_at.label("updated_at"),
    ).where(condition)


def search_details(db: Session, ids: list[int]) -> dict[int, SearchDetail]:
    """What a search result shows, for one page of ids only (never all rows)."""
    if not ids:
        return {}
    rows = db.execute(
        select(
            Report.id,
            Report.title,
            Report.body_md,
            Report.project_id,
            Report.severity,
            Report.status,
        ).where(Report.id.in_(ids))
    ).all()
    names = project_names(db, {r.project_id for r in rows})
    return {
        r.id: SearchDetail(
            title=r.title,
            body=r.body_md,
            project_id=r.project_id,
            project_name=names.get(r.project_id),
            severity=r.severity.value,
            status=r.status.value,
        )
        for r in rows
    }


# --- PDF export (Stage 7) ---------------------------------------------------------------


def export_document(db: Session, report_id: int) -> ExportDocument | None:
    """Everything a PDF of this report shows, or None if it no longer exists."""
    report = db.get(Report, report_id)
    if report is None:
        return None
    project = project_names(db, {report.project_id}).get(report.project_id, "")
    fields: list[tuple[str, str | datetime]] = [
        ("project", project),
        ("type", report.type.value),
        ("severity", report.severity.value),
        ("status", report.status.value),
    ]
    if report.cvss_score is not None or report.cvss_vector:
        cvss = " ".join(p for p in (str(report.cvss_score or ""), report.cvss_vector or "") if p)
        fields.append(("cvss", cvss))
    if report.bounty_amount is not None and report.bounty_currency:
        fields.append(("bounty", f"{report.bounty_amount} {report.bounty_currency}"))
    for key in ("submitted_at", "triaged_at", "closed_at", "paid_at"):
        if (value := getattr(report, key)) is not None:
            fields.append((key, value))
    fields += [("created_at", report.created_at), ("updated_at", report.updated_at)]
    return ExportDocument(kind="report", title=report.title, body_md=report.body_md, fields=fields)


# --- dashboard aggregates (always computed from current rows; nothing is stored) ------


def total(db: Session) -> int:
    return db.scalar(select(func.count(Report.id))) or 0


def count_by_severity(db: Session) -> dict[str, int]:
    rows = {
        k: v for k, v in db.execute(select(Report.severity, func.count()).group_by(Report.severity))
    }
    return {s.value: rows.get(s, 0) for s in Severity}


def count_by_status(db: Session) -> dict[str, int]:
    rows = {
        k: v for k, v in db.execute(select(Report.status, func.count()).group_by(Report.status))
    }
    return {s.value: rows.get(s, 0) for s in ReportStatus}


def _month(column):  # noqa: ANN001, ANN202 - SQL expression helper
    # Months are calendar months in UTC (D-77).
    return func.date_trunc("month", func.timezone("UTC", column))


def created_per_month(db: Session, start: date, end: date) -> dict[date, int]:
    """Reports created per UTC month, start <= month <= end (both first-of-month)."""
    month = _month(Report.created_at)
    rows = db.execute(
        select(month, func.count()).where(month >= start, month <= end).group_by(month)
    ).all()
    return {m.date(): n for m, n in rows}


@dataclass
class PaidMonth:
    month: date
    currency: str
    amount: Decimal
    count: int


def paid_per_month(db: Session, start: date, end: date) -> tuple[list[PaidMonth], int]:
    """Paid BBP bounties per UTC month and currency (never summed across currencies),
    plus how many paid reports in the range have no amount recorded."""
    month = _month(Report.paid_at)
    paid = (Report.status == ReportStatus.paid) & (Report.type == ReportType.bbp)
    in_range = (month >= start) & (month <= end)
    rows = db.execute(
        select(month, Report.bounty_currency, func.sum(Report.bounty_amount), func.count())
        .where(paid, in_range, Report.bounty_amount.is_not(None))
        .group_by(month, Report.bounty_currency)
        .order_by(month, Report.bounty_currency)
    ).all()
    unpriced = db.scalar(select(func.count()).where(paid, in_range, Report.bounty_amount.is_(None)))
    return [PaidMonth(m.date(), c, a, n) for m, c, a, n in rows], unpriced or 0


@dataclass
class UnpaidTotal:
    currency: str
    amount: Decimal
    count: int


# A bounty recorded on a report that may still be paid. Rejected and duplicate reports
# will not be, so their amounts are not listed.
_MAY_BE_PAID = (
    ReportStatus.draft,
    ReportStatus.submitted,
    ReportStatus.triaged,
    ReportStatus.accepted,
)


def unpaid_bounties(db: Session) -> list[UnpaidTotal]:
    """Bounty amounts on BBP reports not marked Paid, per currency (any date).

    Never earnings: shown apart, so an amount typed on a draft is visible without
    being counted as money received.
    """
    rows = db.execute(
        select(Report.bounty_currency, func.sum(Report.bounty_amount), func.count())
        .where(
            Report.type == ReportType.bbp,
            Report.status.in_(_MAY_BE_PAID),
            Report.bounty_amount.is_not(None),
        )
        .group_by(Report.bounty_currency)
        .order_by(Report.bounty_currency)
    ).all()
    return [UnpaidTotal(c, a, n) for c, a, n in rows]


def evidence_path(storage_name: str) -> Path:
    """Where an evidence file's bytes live (full-data export reads them)."""
    return path_for(storage_name)
