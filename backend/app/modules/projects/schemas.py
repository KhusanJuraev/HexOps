from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator
from pydantic_core import InitErrorDetails, PydanticCustomError, ValidationError

from app.modules.projects.models import ProjectStatus, ProjectType, ScopeKind
from app.modules.projects.scope import check_value, duplicate_key

MAX_SCOPE_ITEMS = 500


class ScopeItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ScopeKind
    value: str = Field(min_length=1, max_length=512)
    note: str = Field(default="", max_length=1000)

    @field_validator("value")
    @classmethod
    def valid_for_kind(cls, value: str, info: ValidationInfo) -> str:
        kind = info.data.get("kind")
        if kind is not None and (code := check_value(kind, value)):
            raise PydanticCustomError(code, "Invalid {kind} scope entry", {"kind": kind.value})
        return value


class ProjectIn(BaseModel):
    """Create and full update (PUT) share one shape: the form always sends everything."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    type: ProjectType
    status: ProjectStatus = ProjectStatus.active
    start_date: date | None = None
    description: str = Field(default="", max_length=10_000)
    scope: list[ScopeItemIn] = Field(default_factory=list, max_length=MAX_SCOPE_ITEMS)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        # The name is free text: collapsing outer whitespace is a safe normalization.
        # Scope values are never touched.
        return value.strip() if isinstance(value, str) else value

    @field_validator("start_date")
    @classmethod
    def plausible_date(cls, value: date | None) -> date | None:
        if value is not None and not date(1990, 1, 1) <= value <= date(2100, 12, 31):
            raise PydanticCustomError("date_out_of_range", "Date must be between 1990 and 2100")
        return value

    @model_validator(mode="after")
    def no_duplicate_scope(self) -> "ProjectIn":
        seen: set[tuple[str, str]] = set()
        errors: list[InitErrorDetails] = []
        for i, item in enumerate(self.scope):
            key = duplicate_key(item.kind, item.value)
            if key in seen:
                errors.append(
                    {
                        "type": PydanticCustomError("scope_duplicate", "Duplicate scope entry"),
                        "loc": ("scope", i, "value"),
                        "input": item.value,
                    }
                )
            seen.add(key)
        if errors:
            raise ValidationError.from_exception_data("ProjectIn", errors)
        return self


class ScopeItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: ScopeKind
    value: str
    note: str


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: ProjectType
    status: ProjectStatus
    start_date: date | None
    description: str
    scope: list[ScopeItemOut]
    created_at: datetime
    updated_at: datetime


class ProjectListItem(BaseModel):
    """List rows carry no description or scope bodies, only a count."""

    id: int
    name: str
    type: ProjectType
    status: ProjectStatus
    start_date: date | None
    scope_count: int
    created_at: datetime
    updated_at: datetime


class ProjectPage(BaseModel):
    items: list[ProjectListItem]
    total: int
    page: int
    size: int


SortField = Literal["name", "start_date", "status", "created_at", "updated_at"]


class ProjectQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = Field(default="", max_length=200)
    type: ProjectType | None = None
    status: ProjectStatus | None = None
    sort: SortField = "updated_at"
    order: Literal["asc", "desc"] = "desc"
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=20, ge=1, le=100)
