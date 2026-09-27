import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Computed,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from app.core.db import Base, TimestampMixin
from app.core.textsearch import search_vector_sql


class ReportType(enum.StrEnum):
    cve = "cve"
    bbp = "bbp"
    vdp = "vdp"
    pentest = "pentest"


class Severity(enum.StrEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class ReportStatus(enum.StrEnum):
    draft = "draft"
    submitted = "submitted"
    triaged = "triaged"
    accepted = "accepted"
    duplicate = "duplicate"
    rejected = "rejected"
    paid = "paid"


def _enum(cls: type[enum.StrEnum], name: str) -> Enum:
    # VARCHAR + CHECK, like Projects (D-54).
    return Enum(cls, name=name, native_enum=False, create_constraint=True, length=32)


class Report(TimestampMixin, Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("cvss_score >= 0 AND cvss_score <= 10", name="cvss_score_range"),
        CheckConstraint("bounty_amount >= 0", name="bounty_amount_positive"),
        CheckConstraint("bounty_currency ~ '^[A-Z]{3}$'", name="bounty_currency_iso"),
        CheckConstraint(
            "(bounty_amount IS NULL) = (bounty_currency IS NULL)", name="bounty_amount_currency"
        ),
        CheckConstraint("status <> 'paid' OR type = 'bbp'", name="paid_only_bbp"),
        Index("ix_reports_project_updated_at", "project_id", "updated_at"),
        Index("ix_reports_status_updated_at", "status", "updated_at"),
        Index("ix_reports_updated_at", "updated_at"),
        Index("ix_reports_created_at", "created_at"),
        Index("ix_reports_submitted_at", "submitted_at"),
        Index("ix_reports_severity", "severity"),
        Index("ix_reports_type", "type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # RESTRICT: a project with reports cannot be deleted (D-60).
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    type: Mapped[ReportType] = mapped_column(_enum(ReportType, "report_type"), nullable=False)
    # The researcher's own rating. CVSS never overwrites it (D-24, D-61).
    severity: Mapped[Severity] = mapped_column(_enum(Severity, "severity"), nullable=False)
    cvss_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    cvss_vector: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[ReportStatus] = mapped_column(
        _enum(ReportStatus, "report_status"), nullable=False, default=ReportStatus.draft
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    triaged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bounty_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    bounty_currency: Mapped[str | None] = mapped_column(String(3))
    body_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Stored full-text vector for Stage 6 search (D-76); never loaded unless asked for.
    search_vector: Mapped[str] = deferred(
        mapped_column(TSVECTOR, Computed(search_vector_sql("title", "body_md"), persisted=True))
    )

    attachments: Mapped[list["Attachment"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, order_by="Attachment.id"
    )


# Case-insensitive sort by title.
Index("ix_reports_title_lower", func.lower(Report.title))
# Search (D-76): full-text over search_vector, substring (identifiers) over trigrams.
Index("ix_reports_search_vector", Report.search_vector, postgresql_using="gin")
Index(
    "ix_reports_title_trgm",
    Report.title,
    postgresql_using="gin",
    postgresql_ops={"title": "gin_trgm_ops"},
)
Index(
    "ix_reports_body_trgm",
    Report.body_md,
    postgresql_using="gin",
    postgresql_ops={"body_md": "gin_trgm_ops"},
)


class Attachment(Base):
    """Evidence metadata. The bytes live in uploads_dir under storage_name (D-62)."""

    __tablename__ = "report_attachments"
    __table_args__ = (
        CheckConstraint("storage_name ~ '^[0-9a-f]{32}$'", name="storage_name_format"),
        CheckConstraint("size_bytes >= 0", name="size_positive"),
        Index("ix_report_attachments_report_id", "report_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), nullable=False
    )
    storage_name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
