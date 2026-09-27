"""The projects module's public interface. Other modules import only from here.

Reports (Stage 4) and Notes (Stage 5) link records to projects through this.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.projects import service
from app.modules.projects.models import Project, ProjectStatus

__all__ = ["count_by_status", "project_exists", "project_names", "require_project"]


def require_project(db: Session, project_id: int) -> int:
    """Return project_id if the project exists; raise the 404 project_not_found API error."""
    return service.get_project(db, project_id).id


def project_exists(db: Session, project_id: int) -> bool:
    return db.get(Project, project_id) is not None


def project_names(db: Session, project_ids: set[int]) -> dict[int, str]:
    """id -> name, for showing a linked project without loading it."""
    if not project_ids:
        return {}
    rows = db.execute(select(Project.id, Project.name).where(Project.id.in_(project_ids)))
    return {project_id: name for project_id, name in rows}


def count_by_status(db: Session) -> dict[str, int]:
    """Projects per status, computed from current rows."""
    rows = {
        k: v for k, v in db.execute(select(Project.status, func.count()).group_by(Project.status))
    }
    return {s.value: rows.get(s, 0) for s in ProjectStatus}
