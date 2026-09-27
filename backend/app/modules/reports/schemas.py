from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError, ValidationError

from app.modules.reports.cvss import is_valid_vector
from app.modules.reports.models import ReportStatus, ReportType, Severity

MAX_BODY_CHARS = 200_000


def _field_error(field: str, code: str, message: str) -> ValidationError:
    """A validation error pinned to one field, raised from a model validator."""
    return ValidationError.from_exception_data(
        "ReportIn",
        [{"type": PydanticCustomError(code, message), "loc": (field,), "input": None}],
    )


class ReportIn(BaseModel):
    """Create and full update. Status is not part of it: see StatusChangeIn."""

    model_config = ConfigDict(extra="forbid")

    project_id: int = Field(gt=0, le=2_147_483_647)
    title: str = Field(min_length=1, max_length=300)
    type: ReportType
    severity: Severity
    cvss_score: Decimal | None = Field(default=None, ge=0, le=10, max_digits=3, decimal_places=1)
    cvss_vector: str | None = Field(default=None, max_length=200)
    body_md: str = Field(default="", max_length=MAX_BODY_CHARS)
    bounty_amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    bounty_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("cvss_vector", "bounty_currency", mode="before")
    @classmethod
    def empty_is_none(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("cvss_vector")
    @classmethod
    def valid_vector(cls, value: str | None) -> str | None:
        if value is not None and not is_valid_vector(value):
            raise PydanticCustomError("cvss_vector_invalid", "Not a CVSS 3.x or 4.0 vector")
        return value

    @model_validator(mode="after")
    def bounty_rules(self) -> "ReportIn":
        if (self.bounty_amount is None) != (self.bounty_currency is None):
            missing = "bounty_currency" if self.bounty_currency is None else "bounty_amount"
            raise _field_error(missing, "bounty_incomplete", "Give both amount and currency")
        if self.bounty_amount is not None and self.type != ReportType.bbp:
            raise _field_error("bounty_amount", "bounty_requires_bbp", "Bounties are for BBP")
        return self


class StatusChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to: ReportStatus
    # true = undo the last step (D-25); must be explicit so a slip cannot move backwards.
    correction: bool = False
    # When the step happened, if not now (e.g. the report was submitted yesterday).
    at: datetime | None = None


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    project_name: str
    title: str
    type: ReportType
    severity: Severity
    cvss_score: Decimal | None
    cvss_vector: str | None
    status: ReportStatus
    submitted_at: datetime | None
    triaged_at: datetime | None
    closed_at: datetime | None
    paid_at: datetime | None
    bounty_amount: Decimal | None
    bounty_currency: str | None
    body_md: str
    created_at: datetime
    updated_at: datetime
    # What the UI may offer next; the server re-checks every request anyway.
    next_statuses: list[ReportStatus]
    correction_to: ReportStatus | None


class ReportListItem(BaseModel):
    """No Markdown body and no attachments in list rows."""

    id: int
    project_id: int
    project_name: str
    title: str
    type: ReportType
    severity: Severity
    cvss_score: Decimal | None
    status: ReportStatus
    submitted_at: datetime | None
    bounty_amount: Decimal | None
    bounty_currency: str | None
    created_at: datetime
    updated_at: datetime


class ReportPage(BaseModel):
    items: list[ReportListItem]
    total: int
    page: int
    size: int


ReportSort = Literal["updated_at", "created_at", "submitted_at", "severity", "status", "title"]


class ReportQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = Field(default="", max_length=200)
    project_id: int | None = Field(default=None, gt=0, le=2_147_483_647)
    type: ReportType | None = None
    severity: Severity | None = None
    status: ReportStatus | None = None
    # Created between these days (UTC), both included.
    created_from: date | None = None
    created_to: date | None = None
    sort: ReportSort = "updated_at"
    order: Literal["asc", "desc"] = "desc"
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=20, ge=1, le=100)

    @model_validator(mode="after")
    def check_dates(self) -> "ReportQuery":
        if self.created_from and self.created_to and self.created_from > self.created_to:
            raise _field_error("created_to", "date_range_reversed", "The end is before the start")
        return self


class EvidenceLimits(BaseModel):
    max_bytes: int
    max_files: int


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_id: int
    original_name: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime
