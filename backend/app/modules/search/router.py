from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ErrorBody
from app.modules.auth.public import require_user
from app.modules.search import service
from app.modules.search.schemas import SearchPage, SearchQuery

router = APIRouter(
    prefix="/api/search",
    tags=["search"],
    dependencies=[Depends(require_user)],
    responses={code: {"model": ErrorBody} for code in (401, 422)},
)


@router.get("", response_model=SearchPage)
def search(q: Annotated[SearchQuery, Query()], db: Session = Depends(get_db)) -> SearchPage:
    """Reports and notes: titles and Markdown bodies. See app/core/textsearch.py."""
    return service.search(db, q)
