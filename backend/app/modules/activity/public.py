"""The activity module's public interface. Other modules import only from here.

    from app.modules.activity.public import record

    record(db, entity_type="project", entity_id=p.id, actor_id=user.id,
           project_id=p.id, action="project.created", details={"name": p.name})

record() only adds the row to the caller's session, so the event is committed
in the same transaction as the change it describes (or not at all).
"""

from typing import Any

from sqlalchemy.orm import Session

from app.modules.activity.models import ActivityLog

__all__ = ["record"]


def record(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    action: str,
    actor_id: int | None,
    project_id: int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        ActivityLog(
            entity_type=entity_type,
            entity_id=entity_id,
            project_id=project_id,
            actor_user_id=actor_id,
            action=action,
            details=details or {},
        )
    )
