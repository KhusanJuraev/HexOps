import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin


class ProjectType(enum.StrEnum):
    bounty_program = "bounty_program"
    pentest_client = "pentest_client"
    personal_research = "personal_research"


class ProjectStatus(enum.StrEnum):
    active = "active"
    paused = "paused"
    closed = "closed"


class ScopeKind(enum.StrEnum):
    domain = "domain"
    wildcard = "wildcard"
    url = "url"
    ip = "ip"
    cidr = "cidr"
    other = "other"


def _enum(cls: type[enum.StrEnum], name: str) -> Enum:
    # VARCHAR + CHECK instead of a native PG enum: adding a value later is a plain migration.
    return Enum(cls, name=name, native_enum=False, create_constraint=True, length=32)


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_status_updated_at", "status", "updated_at"),
        Index("ix_projects_updated_at", "updated_at"),
        Index("ix_projects_start_date", "start_date"),
        Index("ix_projects_type", "type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[ProjectType] = mapped_column(_enum(ProjectType, "project_type"), nullable=False)
    status: Mapped[ProjectStatus] = mapped_column(
        _enum(ProjectStatus, "project_status"), nullable=False
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    scope: Mapped[list["ScopeItem"]] = relationship(
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ScopeItem.position",
    )


# Case-insensitive sort by name.
Index("ix_projects_name_lower", func.lower(Project.name))


class ScopeItem(Base):
    """One in-scope asset. value is stored exactly as entered (D-28)."""

    __tablename__ = "project_scope_items"
    __table_args__ = (Index("ix_project_scope_items_project_position", "project_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[ScopeKind] = mapped_column(_enum(ScopeKind, "scope_kind"), nullable=False)
    value: Mapped[str] = mapped_column(String(512), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
