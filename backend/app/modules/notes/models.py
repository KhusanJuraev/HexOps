from sqlalchemy import (
    CheckConstraint,
    Column,
    Computed,
    ForeignKey,
    Index,
    String,
    Table,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from app.core.db import Base, TimestampMixin
from app.core.textsearch import search_vector_sql

note_tags = Table(
    "note_tags",
    Base.metadata,
    Column("note_id", ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_note_tags_tag_id", "tag_id"),
)


class Tag(Base):
    """A normalized label such as "recon" or "cheat-sheet" (D-69)."""

    __tablename__ = "tags"
    __table_args__ = (CheckConstraint("char_length(name) BETWEEN 1 AND 32", name="name_length"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)


class Note(TimestampMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_project_updated_at", "project_id", "updated_at"),
        Index("ix_notes_updated_at", "updated_at"),
        Index("ix_notes_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Optional link. Deleting the project keeps the note and only unlinks it (D-68).
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Stored full-text vector for Stage 6 search (D-76); never loaded unless asked for.
    search_vector: Mapped[str] = deferred(
        mapped_column(TSVECTOR, Computed(search_vector_sql("title", "body_md"), persisted=True))
    )

    tags: Mapped[list[Tag]] = relationship(secondary=note_tags, order_by=Tag.name, lazy="selectin")


# Case-insensitive sort by title.
Index("ix_notes_title_lower", func.lower(Note.title))
# Search (D-76): full-text over search_vector, substring (identifiers) over trigrams.
Index("ix_notes_search_vector", Note.search_vector, postgresql_using="gin")
Index(
    "ix_notes_title_trgm",
    Note.title,
    postgresql_using="gin",
    postgresql_ops={"title": "gin_trgm_ops"},
)
Index(
    "ix_notes_body_trgm",
    Note.body_md,
    postgresql_using="gin",
    postgresql_ops={"body_md": "gin_trgm_ops"},
)
