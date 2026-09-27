from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ErrorBody
from app.modules.auth.public import User, require_user
from app.modules.notes import service
from app.modules.notes.schemas import NoteIn, NoteOut, NotePage, NoteQuery, TagCount

router = APIRouter(
    prefix="/api/notes",
    tags=["notes"],
    dependencies=[Depends(require_user)],  # session for all; CSRF + Origin on writes
    responses={code: {"model": ErrorBody} for code in (401, 403, 404, 422)},
)

NoteId = Annotated[int, Path(gt=0, le=2_147_483_647)]
CurrentUser = Annotated[User, Depends(require_user)]
Db = Annotated[Session, Depends(get_db)]


@router.get("", response_model=NotePage)
def list_notes(q: Annotated[NoteQuery, Query()], db: Db) -> NotePage:
    return service.list_notes(db, q)


@router.get("/tags", response_model=list[TagCount])
def list_tags(db: Db) -> list[TagCount]:
    """Every tag in use, with how many notes carry it (for the filter)."""
    return service.list_tags(db)


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(body: NoteIn, user: CurrentUser, db: Db) -> NoteOut:
    return service.to_out(db, service.create_note(db, body, user.id))


@router.get("/{note_id}", response_model=NoteOut)
def get_note(note_id: NoteId, db: Db) -> NoteOut:
    return service.to_out(db, service.get_note(db, note_id))


@router.put("/{note_id}", response_model=NoteOut)
def update_note(note_id: NoteId, body: NoteIn, user: CurrentUser, db: Db) -> NoteOut:
    return service.to_out(db, service.update_note(db, note_id, body, user.id))


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: NoteId, user: CurrentUser, db: Db) -> Response:
    service.delete_note(db, note_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
