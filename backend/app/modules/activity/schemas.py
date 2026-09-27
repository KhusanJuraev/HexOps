from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ActivityQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: int | None = Field(default=None, gt=0)
    entity_type: Literal["project", "report", "note"] | None = None
    entity_id: int | None = Field(default=None, gt=0)
    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=20, ge=1, le=100)


class ActivityOut(BaseModel):
    id: int
    occurred_at: datetime
    entity_type: str
    entity_id: int
    project_id: int | None
    actor: str | None  # username; None for events recorded before Stage 4
    action: str
    details: dict[str, Any]


class ActivityPage(BaseModel):
    items: list[ActivityOut]
    total: int
    page: int
    size: int
