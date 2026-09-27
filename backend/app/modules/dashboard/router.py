from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ErrorBody
from app.modules.auth.public import require_user
from app.modules.dashboard import service
from app.modules.dashboard.schemas import Bounties, Counts, MonthRange, Summary, Timeline

# One endpoint per widget, so each loads and fails on its own (D-77).
router = APIRouter(
    prefix="/api/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(require_user)],
    responses={code: {"model": ErrorBody} for code in (401, 422)},
)
Db = Annotated[Session, Depends(get_db)]
Range = Annotated[MonthRange, Query()]


@router.get("/summary", response_model=Summary)
def summary(db: Db) -> Summary:
    return service.summary(db)


@router.get("/severity", response_model=Counts)
def severity(db: Db) -> Counts:
    return service.severity(db)


@router.get("/status", response_model=Counts)
def status(db: Db) -> Counts:
    return service.statuses(db)


@router.get("/timeline", response_model=Timeline)
def timeline(rng: Range, db: Db) -> Timeline:
    return service.timeline(db, rng)


@router.get("/bounties", response_model=Bounties)
def bounties(rng: Range, db: Db) -> Bounties:
    return service.bounties(db, rng)
