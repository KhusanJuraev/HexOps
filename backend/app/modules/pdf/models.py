import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.core.db import Base


class JobKind(enum.StrEnum):
    export = "export"
    import_ = "import"


class JobStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class SourceType(enum.StrEnum):
    report = "report"
    note = "note"


def _enum(cls: type[enum.StrEnum], name: str) -> Enum:
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda e: [m.value for m in e],
    )


class PdfJob(Base):
    """One PDF export or import, run by the in-process worker (D-83).

    Files (the uploaded PDF, the exported PDF) live in settings.pdf_dir under random
    32-hex names; only those names are stored here. A finished job expires after
    settings.pdf_result_ttl_minutes, and the sweeper deletes the row and its files.
    """

    __tablename__ = "pdf_jobs"
    __table_args__ = (
        CheckConstraint("progress BETWEEN 0 AND 100", name="progress_range"),
        CheckConstraint(
            "(kind = 'export') = (source_type IS NOT NULL AND source_id IS NOT NULL)",
            name="export_has_source",
        ),
        Index("ix_pdf_jobs_status", "status"),
        Index("ix_pdf_jobs_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[JobKind] = mapped_column(_enum(JobKind, "pdf_job_kind"), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        _enum(JobStatus, "pdf_job_status"), nullable=False, default=JobStatus.queued
    )
    progress: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lang: Mapped[str] = mapped_column(String(2), nullable=False, default="en")

    # Export: what to print. No foreign key: the record may be deleted meanwhile,
    # and the job then fails with pdf_source_not_found.
    source_type: Mapped[SourceType | None] = mapped_column(_enum(SourceType, "pdf_source_type"))
    source_id: Mapped[int | None] = mapped_column(Integer)

    # Import: the uploaded file (deleted as soon as it has been read).
    input_name: Mapped[str | None] = mapped_column(String(32))
    original_name: Mapped[str | None] = mapped_column(String(255))

    # Results.
    result_name: Mapped[str | None] = mapped_column(String(32))
    result_filename: Mapped[str | None] = mapped_column(String(255))
    draft_title: Mapped[str | None] = mapped_column(String(300))
    draft_md: Mapped[str | None] = deferred(mapped_column(Text))
    page_count: Mapped[int | None] = mapped_column(Integer)
    warnings: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    error_code: Mapped[str | None] = mapped_column(String(64))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the job is created (for abandoned queued jobs) and reset when it finishes.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
