from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.activity.models import ActivityLog
from app.modules.activity.schemas import ActivityOut, ActivityPage, ActivityQuery
from app.modules.auth.public import usernames


def list_activity(db: Session, q: ActivityQuery) -> ActivityPage:
    """Newest first; optionally one project's or one record's history."""
    base = select(ActivityLog)
    if q.project_id is not None:
        base = base.where(ActivityLog.project_id == q.project_id)
    if q.entity_type is not None:
        base = base.where(ActivityLog.entity_type == q.entity_type)
    if q.entity_id is not None:
        base = base.where(ActivityLog.entity_id == q.entity_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(ActivityLog.occurred_at.desc(), ActivityLog.id.desc())
        .offset((q.page - 1) * q.size)
        .limit(q.size)
    ).all()
    names = usernames(db, {r.actor_user_id for r in rows if r.actor_user_id is not None})
    items = [
        ActivityOut(
            id=r.id,
            occurred_at=r.occurred_at,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            project_id=r.project_id,
            actor=names.get(r.actor_user_id) if r.actor_user_id is not None else None,
            action=r.action,
            details=r.details,
        )
        for r in rows
    ]
    return ActivityPage(items=items, total=total, page=q.page, size=q.size)
