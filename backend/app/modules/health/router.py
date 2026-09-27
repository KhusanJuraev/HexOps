from fastapi import APIRouter, Depends, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import api_error

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """Public liveness probe. Reveals nothing beyond database reachability."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable", "Database unreachable"
        ) from None
    return {"status": "ok"}
