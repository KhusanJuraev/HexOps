"""Read-only aggregates. Everything is computed from current rows (D-77)."""

from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.modules.dashboard.schemas import (
    Bounties,
    Counts,
    CurrencySeries,
    CurrencyTotal,
    MonthAmount,
    MonthCount,
    MonthRange,
    Summary,
    Timeline,
)
from app.modules.notes import public as notes
from app.modules.projects import public as projects
from app.modules.reports import public as reports


def _today() -> date:
    return datetime.now(UTC).date()


def _key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def summary(db: Session) -> Summary:
    by_status = projects.count_by_status(db)
    return Summary(
        projects=by_status,
        active_projects=by_status["active"],
        reports=reports.total(db),
        notes=notes.total(db),
    )


def severity(db: Session) -> Counts:
    counts = reports.count_by_severity(db)
    return Counts(counts=counts, total=sum(counts.values()))


def statuses(db: Session) -> Counts:
    counts = reports.count_by_status(db)
    return Counts(counts=counts, total=sum(counts.values()))


def timeline(db: Session, rng: MonthRange) -> Timeline:
    months = rng.months(_today())
    found = reports.created_per_month(db, months[0], months[-1])
    series = [MonthCount(month=_key(m), count=found.get(m, 0)) for m in months]  # zero-filled
    return Timeline(months=series, total=sum(p.count for p in series))


def bounties(db: Session, rng: MonthRange) -> Bounties:
    months = rng.months(_today())
    rows, unpriced = reports.paid_per_month(db, months[0], months[-1])
    per_currency: dict[str, dict[date, tuple[Decimal, int]]] = defaultdict(dict)
    for row in rows:
        per_currency[row.currency][row.month] = (row.amount, row.count)
    series = []
    for currency in sorted(per_currency):
        points = per_currency[currency]
        series.append(
            CurrencySeries(
                currency=currency,
                total=str(sum((a for a, _ in points.values()), Decimal("0"))),
                count=sum(n for _, n in points.values()),
                months=[
                    MonthAmount(
                        month=_key(m),
                        amount=str(points.get(m, (Decimal("0.00"), 0))[0]),
                        count=points.get(m, (Decimal("0"), 0))[1],
                    )
                    for m in months
                ],
            )
        )
    unpaid = [
        CurrencyTotal(currency=u.currency, total=str(u.amount), count=u.count)
        for u in reports.unpaid_bounties(db)
    ]
    return Bounties(currencies=series, unpriced_paid=unpriced, unpaid=unpaid)
