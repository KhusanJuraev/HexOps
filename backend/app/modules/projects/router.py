from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ErrorBody
from app.modules.auth.public import User, require_user
from app.modules.projects import service
from app.modules.projects.schemas import ProjectIn, ProjectOut, ProjectPage, ProjectQuery

router = APIRouter(
    prefix="/api/projects",
    tags=["projects"],
    dependencies=[Depends(require_user)],  # session for all; CSRF + Origin on writes
    responses={code: {"model": ErrorBody} for code in (401, 403, 404, 409, 422)},
)

ProjectId = Annotated[int, Path(gt=0, le=2_147_483_647)]


@router.get("", response_model=ProjectPage)
def list_projects(
    q: Annotated[ProjectQuery, Query()], db: Session = Depends(get_db)
) -> ProjectPage:
    return service.list_projects(db, q)


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectIn, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> ProjectOut:
    return ProjectOut.model_validate(service.create_project(db, body, user.id))


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: ProjectId, db: Session = Depends(get_db)) -> ProjectOut:
    return ProjectOut.model_validate(service.get_project(db, project_id))


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: ProjectId,
    body: ProjectIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    return ProjectOut.model_validate(service.update_project(db, project_id, body, user.id))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: ProjectId, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> Response:
    service.delete_project(db, project_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
