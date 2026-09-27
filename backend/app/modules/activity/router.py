from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ErrorBody
from app.modules.activity import service
from app.modules.activity.schemas import ActivityPage, ActivityQuery
from app.modules.auth.public import require_user

router = APIRouter(
    prefix="/api/activity",
    tags=["activity"],
    dependencies=[Depends(require_user)],
    responses={code: {"model": ErrorBody} for code in (401, 422)},
)


@router.get("", response_model=ActivityPage)
def list_activity(
    q: Annotated[ActivityQuery, Query()], db: Session = Depends(get_db)
) -> ActivityPage:
    return service.list_activity(db, q)
