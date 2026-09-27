from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.textsearch import MAX_TERMS
from app.modules.notes.public import normalize_tag


class SearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = Field(min_length=1, max_length=200)
    kind: Literal["all", "report", "note"] = "all"
    # Note tags; with any tag, only notes can match. Every tag must be present.
    tag: list[str] = Field(default_factory=list, max_length=MAX_TERMS)
    page: int = Field(default=1, ge=1, le=1000)
    size: int = Field(default=20, ge=1, le=50)

    @field_validator("tag")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(normalize_tag(t) for t in value))


class SearchHit(BaseModel):
    kind: Literal["report", "note"]
    id: int
    title: str
    # A short plain-text excerpt around the first match: never the whole body.
    snippet: str
    project_id: int | None
    project_name: str | None
    updated_at: datetime
    severity: str | None = None
    status: str | None = None
    tags: list[str] | None = None


class SearchPage(BaseModel):
    items: list[SearchHit]
    total: int
    page: int
    size: int
    # The terms the server matched on, for highlighting.
    terms: list[str]
