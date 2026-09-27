"""Report status workflow (D-25, D-63). Pure rules; the service applies them.

Forward:   draft → submitted → triaged → accepted | duplicate | rejected;
           accepted → paid (BBP reports only).
Corrections undo exactly one step and clear that step's date:
           submitted → draft, triaged → submitted,
           accepted | duplicate | rejected → triaged, paid → accepted.
"""

from app.modules.reports.models import ReportStatus as S
from app.modules.reports.models import ReportType

FORWARD: dict[S, frozenset[S]] = {
    S.draft: frozenset({S.submitted}),
    S.submitted: frozenset({S.triaged}),
    S.triaged: frozenset({S.accepted, S.duplicate, S.rejected}),
    S.accepted: frozenset({S.paid}),
    S.duplicate: frozenset(),
    S.rejected: frozenset(),
    S.paid: frozenset(),
}

BACK: dict[S, S] = {
    S.submitted: S.draft,
    S.triaged: S.submitted,
    S.accepted: S.triaged,
    S.duplicate: S.triaged,
    S.rejected: S.triaged,
    S.paid: S.accepted,
}

# The date column a status sets when entered (and clears when corrected away).
DATE_FIELD: dict[S, str] = {
    S.submitted: "submitted_at",
    S.triaged: "triaged_at",
    S.accepted: "closed_at",
    S.duplicate: "closed_at",
    S.rejected: "closed_at",
    S.paid: "paid_at",
}


class TransitionError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def allowed_forward(current: S, report_type: ReportType) -> list[S]:
    targets = FORWARD[current]
    if report_type != ReportType.bbp:
        targets = targets - {S.paid}
    return sorted(targets, key=list(S).index)


def check(current: S, target: S, report_type: ReportType, correction: bool) -> None:
    """Raise TransitionError unless current → target is legal for this report."""
    if correction:
        if BACK.get(current) != target:
            raise TransitionError("invalid_status_correction")
        return
    if target == S.paid and report_type != ReportType.bbp and S.paid in FORWARD[current]:
        raise TransitionError("paid_requires_bbp")
    if target not in FORWARD[current]:
        raise TransitionError("invalid_status_transition")
