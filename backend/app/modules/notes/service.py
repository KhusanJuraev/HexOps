from typing import Any

from fastapi import status
from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import api_error, field_error
from app.modules.activity.public import record
from app.modules.notes.models import Note, Tag, note_tags
from app.modules.notes.schemas import NoteIn, NoteListItem, NoteOut, NotePage, NoteQuery, TagCount
from app.modules.projects.public import project_exists, project_names

_SORT = {
    "updated_at": Note.updated_at,
    "created_at": Note.created_at,
    "title": func.lower(Note.title),
}


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _event(db: Session, note: Note, action: str, actor_id: int, details: dict[str, Any]) -> None:
    record(
        db,
        entity_type="note",
        entity_id=note.id,
        actor_id=actor_id,
        project_id=note.project_id,
        action=action,
        details=details,
    )


def get_note(db: Session, note_id: int) -> Note:
    note = db.get(Note, note_id)
    if note is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "note_not_found", "Note not found")
    return note


def to_out(db: Session, note: Note) -> NoteOut:
    names = project_names(db, {note.project_id} if note.project_id else set())
    return NoteOut(
        id=note.id,
        title=note.title,
        body_md=note.body_md,
        project_id=note.project_id,
        project_name=names.get(note.project_id) if note.project_id else None,
        tags=[t.name for t in note.tags],
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def list_notes(db: Session, q: NoteQuery) -> NotePage:
    filters = []
    if q.q.strip():
        # Keyword match in title or body. Stage 6 replaces this with full-text search.
        like = f"%{_escape_like(q.q.strip())}%"
        filters.append(
            or_(Note.title.ilike(like, escape="\\"), Note.body_md.ilike(like, escape="\\"))
        )
    if q.project_id is not None:
        filters.append(Note.project_id == q.project_id)
    for name in q.tag:  # AND: every requested tag must be present
        filters.append(
            exists().where(
                note_tags.c.note_id == Note.id, note_tags.c.tag_id == Tag.id, Tag.name == name
            )
        )
    total = db.scalar(select(func.count(Note.id)).where(*filters)) or 0
    column = _SORT[q.sort]
    ordering = column.asc() if q.order == "asc" else column.desc()
    tiebreak = Note.id.asc() if q.order == "asc" else Note.id.desc()
    # Only list columns are loaded: the Markdown body stays in the database.
    rows = db.execute(
        select(Note.id, Note.title, Note.project_id, Note.created_at, Note.updated_at)
        .where(*filters)
        .order_by(ordering, tiebreak)
        .offset((q.page - 1) * q.size)
        .limit(q.size)
    ).all()
    ids = [r.id for r in rows]
    tags: dict[int, list[str]] = {i: [] for i in ids}
    if ids:
        for note_id, name in db.execute(
            select(note_tags.c.note_id, Tag.name)
            .join(Tag, Tag.id == note_tags.c.tag_id)
            .where(note_tags.c.note_id.in_(ids))
            .order_by(Tag.name)
        ):
            tags[note_id].append(name)
    names = project_names(db, {r.project_id for r in rows if r.project_id})
    items = [
        NoteListItem(
            **r._asdict(),
            project_name=names.get(r.project_id) if r.project_id else None,
            tags=tags[r.id],
        )
        for r in rows
    ]
    return NotePage(items=items, total=total, page=q.page, size=q.size)


def list_tags(db: Session) -> list[TagCount]:
    rows = db.execute(
        select(Tag.name, func.count(note_tags.c.note_id))
        .join(note_tags, note_tags.c.tag_id == Tag.id)
        .group_by(Tag.name)
        .order_by(Tag.name)
    )
    return [TagCount(name=n, count=c) for n, c in rows]


def _tags(db: Session, names: list[str]) -> list[Tag]:
    existing = {t.name: t for t in db.scalars(select(Tag).where(Tag.name.in_(names)))}
    return [existing.get(n) or Tag(name=n) for n in names]


def _drop_unused_tags(db: Session) -> None:
    db.execute(delete(Tag).where(~exists().where(note_tags.c.tag_id == Tag.id)))


def _check_project(db: Session, project_id: int | None) -> None:
    if project_id is not None and not project_exists(db, project_id):
        raise field_error("project_id", "project_not_found", "Project not found")


def create_note(db: Session, data: NoteIn, actor_id: int) -> Note:
    _check_project(db, data.project_id)
    note = Note(title=data.title, body_md=data.body_md, project_id=data.project_id)
    note.tags = _tags(db, data.tags)
    db.add(note)
    db.flush()
    _event(db, note, "note.created", actor_id, {"title": note.title})
    db.commit()
    db.refresh(note)
    return note


def update_note(db: Session, note_id: int, data: NoteIn, actor_id: int) -> Note:
    note = get_note(db, note_id)
    if data.project_id != note.project_id:
        _check_project(db, data.project_id)
    changed = [
        f for f in ("title", "body_md", "project_id") if getattr(note, f) != getattr(data, f)
    ]
    if sorted(t.name for t in note.tags) != sorted(data.tags):
        changed.append("tags")
    if not changed:
        return note
    note.title, note.body_md, note.project_id = data.title, data.body_md, data.project_id
    if "tags" in changed:
        note.tags = _tags(db, data.tags)
    note.updated_at = func.now()
    db.flush()
    _drop_unused_tags(db)
    _event(db, note, "note.updated", actor_id, {"fields": changed})
    db.commit()
    db.refresh(note)
    return note


def delete_note(db: Session, note_id: int, actor_id: int) -> None:
    note = get_note(db, note_id)
    _event(db, note, "note.deleted", actor_id, {"title": note.title})
    db.delete(note)
    db.flush()
    _drop_unused_tags(db)
    db.commit()
