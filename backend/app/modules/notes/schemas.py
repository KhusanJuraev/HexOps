import re
import unicodedata
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

MAX_BODY_CHARS = 200_000
MAX_TAGS = 20
# Letters of any script, digits, "-" and "_"; starts with a letter or digit.
_TAG = re.compile(r"^[^\W_][\w-]{0,31}$")


def normalize_tag(raw: str) -> str:
    """Trim, NFC, lower-case. Anything else invalid is rejected, not rewritten."""
    tag = unicodedata.normalize("NFC", raw.strip()).lower()
    if not _TAG.fullmatch(tag):
        raise PydanticCustomError("tag_invalid", "Tags use letters, digits, '-' and '_'")
    return tag


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    body_md: str = Field(default="", max_length=MAX_BODY_CHARS)
    project_id: int | None = Field(default=None, gt=0, le=2_147_483_647)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        # Normalized and de-duplicated, keeping the order given.
        return list(dict.fromkeys(normalize_tag(t) for t in value))


class NoteOut(BaseModel):
    id: int
    title: str
    body_md: str
    project_id: int | None
    project_name: str | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class NoteListItem(BaseModel):
    """No Markdown body in list rows."""

    id: int
    title: str
    project_id: int | None
    project_name: str | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class NotePage(BaseModel):
    items: list[NoteListItem]
    total: int
    page: int
    size: int


class NoteQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = Field(default="", max_length=200)
    # Repeat ?tag= for several; a note must have all of them.
    tag: list[str] = Field(default_factory=list, max_length=MAX_TAGS)
    project_id: int | None = Field(default=None, gt=0, le=2_147_483_647)
    sort: Literal["updated_at", "created_at", "title"] = "updated_at"
    order: Literal["asc", "desc"] = "desc"
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=20, ge=1, le=100)

    @field_validator("tag")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(normalize_tag(t) for t in value))


class TagCount(BaseModel):
    name: str
    count: int
