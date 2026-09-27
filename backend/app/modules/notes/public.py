"""The notes module's public interface. Other modules import only from here.

Used by search and the dashboard (Stage 6) and PDF export (Stage 7). Read-only.
"""

from datetime import datetime

from sqlalchemy import Select, exists, func, literal, select
from sqlalchemy.orm import Session

from app.core.export import ExportDocument
from app.core.textsearch import ParsedQuery, SearchDetail, match
from app.modules.notes.models import Note, Tag, note_tags
from app.modules.notes.schemas import normalize_tag
from app.modules.projects.public import project_names

__all__ = ["export_document", "normalize_tag", "search_details", "search_select", "total"]


def search_select(parsed: ParsedQuery, tags: list[str]) -> Select:
    """Matching notes as (kind, id, rank, updated_at). Every given tag must be present."""
    condition, rank = match(parsed, Note.search_vector, Note.title, Note.body_md)
    query = select(
        literal("note").label("kind"),
        Note.id.label("id"),
        rank.label("rank"),
        Note.updated_at.label("updated_at"),
    ).where(condition)
    for name in tags:
        query = query.where(
            exists().where(
                note_tags.c.note_id == Note.id, note_tags.c.tag_id == Tag.id, Tag.name == name
            )
        )
    return query


def search_details(db: Session, ids: list[int]) -> dict[int, SearchDetail]:
    if not ids:
        return {}
    notes = db.scalars(select(Note).where(Note.id.in_(ids))).all()
    names = project_names(db, {n.project_id for n in notes if n.project_id})
    return {
        n.id: SearchDetail(
            title=n.title,
            body=n.body_md,
            project_id=n.project_id,
            project_name=names.get(n.project_id) if n.project_id else None,
            tags=[t.name for t in n.tags],
        )
        for n in notes
    }


def total(db: Session) -> int:
    return db.scalar(select(func.count(Note.id))) or 0


def export_document(db: Session, note_id: int) -> ExportDocument | None:
    """Everything a PDF of this note shows (Stage 7), or None if it no longer exists."""
    note = db.get(Note, note_id)
    if note is None:
        return None
    fields: list[tuple[str, str | datetime]] = []
    if note.project_id is not None:
        fields.append(("project", project_names(db, {note.project_id}).get(note.project_id, "")))
    fields += [("created_at", note.created_at), ("updated_at", note.updated_at)]
    return ExportDocument(
        kind="note",
        title=note.title,
        body_md=note.body_md,
        fields=fields,
        tags=[t.name for t in note.tags],
    )
