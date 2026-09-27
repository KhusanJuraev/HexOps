from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ActivityLog(Base):
    """Append-only history of changes across modules.

    project_id is a plain indexed integer, not a foreign key: the log must outlive
    the records it describes (a deleted project keeps its history), and the
    activity module must not depend on other modules' tables (D-53).
    """

    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_project_occurred", "project_id", "occurred_at"),
        Index("ix_activity_logs_occurred_at", "occurred_at"),
        Index("ix_activity_logs_entity", "entity_type", "entity_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    project_id: Mapped[int | None] = mapped_column(Integer)
    # Who did it (users.id). No foreign key, like project_id: history outlives records.
    actor_user_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    # Small, non-sensitive facts only: field names, status from/to, a record's name.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
