from typing import Any

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.modules.activity.public import record
from app.modules.projects.models import Project, ScopeItem
from app.modules.projects.schemas import ProjectIn, ProjectListItem, ProjectPage, ProjectQuery

_SORT_COLUMNS = {
    "name": func.lower(Project.name),
    "start_date": Project.start_date,
    "status": Project.status,
    "created_at": Project.created_at,
    "updated_at": Project.updated_at,
}
# Fields whose change is reported as "project.updated" (status has its own event).
_TRACKED = ("name", "type", "start_date", "description")


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "project_not_found", "Project not found")
    return project


def list_projects(db: Session, q: ProjectQuery) -> ProjectPage:
    scope_count = (
        select(func.count(ScopeItem.id))
        .where(ScopeItem.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )
    filters = []
    if q.q.strip():
        filters.append(Project.name.ilike(f"%{_escape_like(q.q.strip())}%", escape="\\"))
    if q.type is not None:
        filters.append(Project.type == q.type)
    if q.status is not None:
        filters.append(Project.status == q.status)

    total = db.scalar(select(func.count(Project.id)).where(*filters)) or 0
    column = _SORT_COLUMNS[q.sort]
    ordering = column.asc() if q.order == "asc" else column.desc()
    # NULL start dates go last either way; id keeps pages stable for equal values.
    tiebreak = Project.id.asc() if q.order == "asc" else Project.id.desc()
    rows = db.execute(
        select(Project, scope_count.label("scope_count"))
        .where(*filters)
        .order_by(ordering.nulls_last(), tiebreak)
        .offset((q.page - 1) * q.size)
        .limit(q.size)
    ).all()
    items = [
        ProjectListItem(
            id=p.id,
            name=p.name,
            type=p.type,
            status=p.status,
            start_date=p.start_date,
            scope_count=count,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p, count in rows
    ]
    return ProjectPage(items=items, total=total, page=q.page, size=q.size)


def _scope_rows(data: ProjectIn) -> list[ScopeItem]:
    return [
        ScopeItem(kind=item.kind, value=item.value, note=item.note, position=i)
        for i, item in enumerate(data.scope)
    ]


def create_project(db: Session, data: ProjectIn, actor_id: int) -> Project:
    project = Project(
        name=data.name,
        type=data.type,
        status=data.status,
        start_date=data.start_date,
        description=data.description,
        scope=_scope_rows(data),
    )
    db.add(project)
    db.flush()
    record(
        db,
        entity_type="project",
        entity_id=project.id,
        actor_id=actor_id,
        project_id=project.id,
        action="project.created",
        details={"name": project.name},
    )
    db.commit()
    db.refresh(project)
    return project


def update_project(db: Session, project_id: int, data: ProjectIn, actor_id: int) -> Project:
    project = get_project(db, project_id)
    changed = [f for f in _TRACKED if getattr(project, f) != getattr(data, f)]
    old_scope = [(s.kind, s.value, s.note) for s in project.scope]
    new_scope = [(s.kind, s.value, s.note) for s in data.scope]
    if old_scope != new_scope:
        changed.append("scope")
    old_status = project.status
    if not changed and old_status == data.status:
        return project  # nothing to write, no activity

    for field in _TRACKED:
        setattr(project, field, getattr(data, field))
    project.status = data.status
    if "scope" in changed:
        project.scope = _scope_rows(data)
    project.updated_at = func.now()  # also when only the scope changed

    def event(action: str, details: dict[str, Any]) -> None:
        record(
            db,
            entity_type="project",
            entity_id=project.id,
            actor_id=actor_id,
            project_id=project.id,
            action=action,
            details=details,
        )

    if old_status != data.status:
        event("project.status_changed", {"from": old_status.value, "to": data.status.value})
    if changed:
        event("project.updated", {"fields": changed})
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: int, actor_id: int) -> None:
    project = get_project(db, project_id)
    # The history stays (activity_logs has no foreign key), ending with this event.
    record(
        db,
        entity_type="project",
        entity_id=project.id,
        actor_id=actor_id,
        project_id=project.id,
        action="project.deleted",
        details={"name": project.name},
    )
    db.delete(project)
    try:
        db.commit()
    except IntegrityError:
        # reports.project_id is ON DELETE RESTRICT: a project with reports is never
        # deleted together with them or their evidence (D-60). Nothing was changed.
        db.rollback()
        raise api_error(
            status.HTTP_409_CONFLICT,
            "project_has_reports",
            "Delete or move this project's reports first",
        ) from None
