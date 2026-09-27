import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TransferKind(enum.StrEnum):
    export = "export"
    import_ = "import"


class TransferStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    validated = "validated"  # import only: checked, waiting for the owner's decision
    done = "done"
    failed = "failed"


def _enum(cls: type[enum.StrEnum], name: str) -> Enum:
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda e: [m.value for m in e],
    )


class TransferJob(Base):
    """One full-data export or import (D-90). Never holds the passphrase or record content.

    `archive_name` is the encrypted file in settings.transfer_dir: the export result, or
    the uploaded archive for an import. `preview` holds counts and sizes only.
    """

    __tablename__ = "transfer_jobs"
    __table_args__ = (
        CheckConstraint("progress BETWEEN 0 AND 100", name="progress_range"),
        Index("ix_transfer_jobs_status", "status"),
        Index("ix_transfer_jobs_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[TransferKind] = mapped_column(_enum(TransferKind, "transfer_kind"), nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        _enum(TransferStatus, "transfer_status"), nullable=False, default=TransferStatus.queued
    )
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    progress: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    archive_name: Mapped[str | None] = mapped_column(String(32))
    archive_size: Mapped[int | None] = mapped_column(BigInteger)
    original_name: Mapped[str | None] = mapped_column(String(255))
    preview: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    backup_name: Mapped[str | None] = mapped_column(String(128))
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_detail: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
