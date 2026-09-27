from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.pdf.models import JobKind, JobStatus, SourceType

Lang = Literal["en", "ru", "uz"]


class ExportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: SourceType
    source_id: int = Field(gt=0, le=2_147_483_647)
    lang: Lang = "en"


class DraftOut(BaseModel):
    title: str
    markdown: str


class JobOut(BaseModel):
    id: int
    kind: JobKind
    status: JobStatus
    progress: int
    source_type: SourceType | None
    source_id: int | None
    original_name: str | None
    result_filename: str | None
    page_count: int | None
    warnings: list[str]
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None
    expires_at: datetime
    # Import only, once done: the Markdown draft to review. Never saved automatically.
    draft: DraftOut | None = None


class JobWait(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Long poll: hold the request up to this many seconds until the job changes.
    wait: int = Field(default=0, ge=0, le=25)


class ImportLimits(BaseModel):
    max_bytes: int
    max_pages: int
