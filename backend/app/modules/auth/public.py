"""The auth module's public interface. Other modules import only from here.

    from app.modules.auth.public import require_user

    router = APIRouter(prefix="/api/projects", dependencies=[Depends(require_user)])

require_user authenticates the request and, for non-GET methods, enforces CSRF
and the Origin check. It returns the signed-in User.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.deps import get_current_session, require_user
from app.modules.auth.models import User

__all__ = ["User", "get_current_session", "require_user", "usernames"]


def usernames(db: Session, user_ids: set[int]) -> dict[int, str]:
    """id -> username for display (e.g. who did what in the activity history)."""
    if not user_ids:
        return {}
    rows = db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
    return {uid: name for uid, name in rows}
