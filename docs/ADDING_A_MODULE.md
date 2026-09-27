# Adding a module

HexOps is a **modular monolith**: one backend process, one frontend bundle, one
database. Each feature lives in its own folder and owns its code end to end.
There is no plugin system, no auto-discovery and no microservice split. Every
module is registered by hand in a few explicit places, listed below.

This guide uses **Projects** (Stage 3) as the worked example. Projects is now
built following it. When a snippet here is shortened, the real file is the reference:
- `backend/app/modules/projects/`
- `backend/app/modules/activity/`
- `frontend/src/features/projects/`

Two details differ from the first draft of this guide:
- Enums are stored as `VARCHAR(32)` with a named CHECK (helper `_enum` in `models.py`), not as native PostgreSQL enums (D-54).
- Activity got its own small router (`GET /api/activity`).

## The rules

1. **A feature owns its code.**
   - Backend: `router.py`, `service.py`, `schemas.py`, `models.py`, an optional `public.py`, and its tests under `backend/tests/<name>/`.
   - Frontend: pages, components, API calls, types and tests under `frontend/src/features/<name>/`.
2. **Shared code lives in clearly named folders.**
   - Backend `app/core/`: settings, DB session, crypto, error envelope.
   - Frontend `src/shared/`: API client, error messages, UI primitives, layout, common components, i18n, theme.
   - Shared code never imports a feature.
3. **Cross-module calls go through a small public interface.**
   - Backend: `app/modules/<name>/public.py`.
   - Frontend: `src/features/<name>/index.ts`.
   - Never import another feature's internal files. Never copy its business rules; call its public function instead.
4. **Registration is explicit.**
   - Backend routers: `ROUTERS` in `backend/app/main.py`.
   - Backend models: `backend/app/models.py`.
   - Frontend pages and navigation: `PAGES` in `frontend/src/app/modules.ts`.
5. **Schema changes are Alembic migrations.** Never create tables by hand or from application code.
6. **Failures stay local.**
   - Every page has its own route error boundary (added automatically from `PAGES`).
   - Every data view has its own query and its own loading, empty and error states.
   - Dashboard widgets are wrapped in `ErrorBoundary` one by one.
   - One broken page or widget never blanks the app.

Rules 1–4 are enforced by tests:
- `backend/tests/architecture/test_boundaries.py`
- `backend/tests/architecture/test_route_protection.py`
- `frontend/src/app/architecture.test.ts`
- `frontend/src/app/routes.test.tsx`

## Layout

```
backend/app/
├── core/                 # shared: config, db (Base, TimestampMixin, get_db), security, errors (api_error)
├── modules/<name>/       # one folder per feature
│   ├── models.py         # SQLAlchemy models (tables this module owns)
│   ├── schemas.py        # pydantic request/response models
│   ├── service.py        # business rules; no FastAPI imports
│   ├── router.py         # HTTP layer only: validate, call service, map errors
│   └── public.py         # what other modules may call (optional)
├── main.py               # ROUTERS registry, PUBLIC_ROUTES allowlist, app factory
├── models.py             # imports every module's models (Alembic metadata)
└── cli.py                # `python -m app.cli` entry point
backend/tests/<name>/     # the module's tests; shared fixtures in tests/conftest.py

frontend/src/
├── app/                  # composition root: modules.ts (PAGES), routes, shell, query client
├── shared/               # api/, ui/, components/, layout/, i18n/, theme/, lib/
└── features/<name>/      # pages, components, api.ts, types.ts, tests, index.ts
```

Dependency direction:
- **Backend:** `main` → `modules` → `core`. A module may also use another module's `public.py`.
- **Frontend:** `app` → `features` → `shared`. A feature may also use another feature's `index.ts`.

## Backend, step by step (Projects)

### 1. Models: `app/modules/projects/models.py`

```python
import enum
from datetime import date

from sqlalchemy import Date, Enum, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin


class ProjectType(enum.StrEnum):
    bounty_program = "bounty_program"
    pentest_client = "pentest_client"
    personal_research = "personal_research"


class ProjectStatus(enum.StrEnum):
    active = "active"
    paused = "paused"
    closed = "closed"


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (Index("ix_projects_status_updated", "status", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[ProjectType] = mapped_column(_enum(ProjectType, "project_type"))    # VARCHAR + CHECK
    status: Mapped[ProjectStatus] = mapped_column(_enum(ProjectStatus, "project_status"))
    start_date: Mapped[date | None] = mapped_column(Date, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[list["ScopeItem"]] = relationship(
        cascade="all, delete-orphan", order_by="ScopeItem.position"
    )


class ScopeItem(Base):
    __tablename__ = "project_scope_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))   # domain | wildcard | url | ip | cidr | other
    value: Mapped[str] = mapped_column(String(512))  # stored exactly as entered (D-28)
    note: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int]
```

Register the models in `app/models.py` so that Alembic and the tests see them:

```python
from app.modules.projects.models import Project, ScopeItem
```

### 2. Migration

```bash
cd backend
.venv/bin/alembic revision --autogenerate -m "projects"
```

Read the generated file under `alembic/versions/` before running it:
- Check the enum types, indexes and `ondelete`.
- Make sure `downgrade()` drops everything, including the enum types.

Then run it both ways against the test database:

```bash
HEXOPS_DATABASE_URL=<test url> .venv/bin/alembic upgrade head
HEXOPS_DATABASE_URL=<test url> .venv/bin/alembic downgrade -1
HEXOPS_DATABASE_URL=<test url> .venv/bin/alembic upgrade head
```

`pytest` builds its schema through these migrations, so a broken migration fails the tests.

### 3. Schemas: `app/modules/projects/schemas.py`

Write strict pydantic models with `ConfigDict(extra="forbid")`.

- **Separate models per use:** `ProjectCreate`, `ProjectUpdate`, `ProjectOut`, and `ProjectListItem`. The list item has no scope bodies or long text.
- **Paginated list response:** `ProjectPage(items: list[ProjectListItem], total: int, page: int, size: int)`.
- **Validation errors need no extra code.** They reach the UI as `{code: "validation_error", errors: [{field, code, params}]}`, and the frontend translates them.

### 4. Service: `app/modules/projects/service.py`

The service holds the business rules. It takes a `Session` and plain values, and it knows nothing about HTTP. Examples of what belongs here:
- validating scope entries per kind;
- status changes;
- recording activity;
- list queries with filters, sorting and pagination.

Signal expected failures with the error helper:

```python
from fastapi import status
from app.core.errors import api_error

raise api_error(status.HTTP_404_NOT_FOUND, "project_not_found", "Project not found")
```

The `code` becomes a translation key on the frontend (see step 10).

### 5. Router: `app/modules/projects/router.py`

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ErrorBody
from app.modules.auth.public import require_user
from app.modules.projects import schemas, service

router = APIRouter(
    prefix="/api/projects",
    tags=["projects"],
    dependencies=[Depends(require_user)],   # auth + CSRF on writes, for every route
    responses={code: {"model": ErrorBody} for code in (401, 403, 404, 422)},
)


@router.get("", response_model=schemas.ProjectPage)
def list_projects(params: schemas.ProjectQuery = Depends(), db: Session = Depends(get_db)):
    return service.list_projects(db, params)
```

Register the router in `app/main.py`:

```python
from app.modules.projects.router import router as projects_router

ROUTERS = (
    health_router,
    auth_router,
    projects_router,
)
```

A new route is private by default. `test_route_protection.py` calls every
OpenAPI operation without a session and fails if any returns something other
than 401. Only add a route to `PUBLIC_ROUTES` when it truly must be public.

### 6. Public interface: `app/modules/projects/public.py`

Only what other modules need, documented and small. For example, Reports
(Stage 4) needs to check that a report's project exists:

```python
"""Projects' public interface. Other modules import only from here."""

from sqlalchemy.orm import Session

from app.modules.projects import service


def require_project(db: Session, project_id: int) -> int:
    """Return project_id if the project exists; raise the 404 API error otherwise."""
    return service.get_project(db, project_id).id

__all__ = ["require_project"]
```

Reports then imports `from app.modules.projects.public import require_project`.
Reports must not import `projects.models` or `projects.service`, and must not
re-implement the existence check. `test_boundaries.py` fails on any other import.

Activity logging follows the same pattern. The `activity` module (created in
Stage 3) owns `activity_logs` and exposes
`record(db, *, entity_type, entity_id, project_id, action, details)` in its
`public.py`. Projects, Reports and Notes call that function. None of them write
to the table themselves.

### 7. Tests: `backend/tests/projects/`

1. Create `__init__.py` and `test_projects.py`.
2. Use the shared fixtures from `tests/conftest.py`:
   - `client`: a test client with no session;
   - `logged_in`: a signed-in client;
   - `user`: the test user.
3. Send the CSRF header on writes with `{"X-CSRF-Token": client.cookies["hexops_csrf"]}`.
4. Cover:
   - CRUD persistence;
   - invalid input (check the `code` values);
   - 401 without a session and 403 without CSRF;
   - pagination, filters and sorting;
   - activity events.

## Frontend, step by step (Projects)

### 8. Feature folder: `frontend/src/features/projects/`

```
features/projects/
├── types.ts                 # Project, ProjectListItem, ProjectPage, ScopeItem (mirror schemas.py)
├── api.ts                   # query keys + hooks: useProjects(params), useProject(id), useSaveProject()
├── ProjectsPage.tsx         # list: FilterBar, table/cards, pagination, EmptyState
├── ProjectDetailPage.tsx    # detail: scope, linked reports/notes (empty states), activity
├── components/              # ProjectForm, ScopeEditor, StatusBadge, …
├── ProjectsPage.test.tsx
└── index.ts                 # public: only what other features need
```

`api.ts` uses the shared client. It never calls `fetch` directly, because the
client adds the CSRF header and parses the error envelope:

```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

import type { ProjectPage, ProjectQuery } from './types'

export const projectKeys = {
  all: ['projects'] as const,
  list: (q: ProjectQuery) => ['projects', 'list', q] as const,
  detail: (id: number) => ['projects', 'detail', id] as const,
}

export function useProjects(q: ProjectQuery) {
  return useQuery({
    queryKey: projectKeys.list(q),
    queryFn: ({ signal }) => api<ProjectPage>(`/api/projects?${new URLSearchParams(q)}`, { signal }),
    placeholderData: keepPreviousData, // keep the old page visible while the next one loads
  })
}
```

Pages import shared building blocks from `@/shared/...`:
- `PageHeader`, `EmptyState` and `Badge`;
- `useToast` from `@/shared/components/toast`;
- `fieldErrorMessage` and `apiErrorMessage` from `@/shared/api/errors`, to show translated validation messages next to fields.

`index.ts` exports only what another feature may use. For example, Reports
needs a project picker:

```ts
export { ProjectPicker } from './components/ProjectPicker'
export type { ProjectListItem } from './types'
```

Pages are **not** exported from `index.ts`. The registry loads them lazily by
path, so each page stays its own chunk.

### 9. Register the pages: `frontend/src/app/modules.ts`

The `/projects` entry already exists. Add the detail page next to it:

```ts
{
  path: '/projects',
  page: () => import('@/features/projects/ProjectsPage'),
  nav: { labelKey: 'nav.projects', icon: FolderKanban, section: 'primary' },
},
{ path: '/projects/:projectId', page: () => import('@/features/projects/ProjectDetailPage') },
```

That single list builds both the routes (`app/routes.tsx`) and the sidebar
(`app/shell/AppShell.tsx`). Each entry gets its own lazily loaded chunk and its
own error boundary. Entries without `nav` do not appear in the sidebar. The
Projects link stays highlighted on `/projects/42`.

### 10. Translations

Add every visible string to **all three** of `src/shared/i18n/locales/{en,ru,uz}.json`, under a `projects.*` namespace:
- labels, headings and empty states;
- enum values (`projects.type.bounty_program`, `projects.status.active`, …);
- the backend error codes (`projects.errors.project_not_found`).

`i18n.test.ts` fails if the key sets differ between languages or any value is empty.

### 11. Loading, empty and error states

Every query-backed view handles `isPending` (loading), empty data (`EmptyState`) and `isError` on its own:
- show `apiErrorMessage(t, error)` with a Retry that calls `refetch()`;
- a failed request never throws out of the component.

Unexpected render errors are caught at two levels:
- **Pages:** the route error boundary shows the error in place, and the shell and navigation keep working. This is automatic.
- **Dashboard widgets and other self-contained sections:** wrap each one on its own, so one failing widget does not take down the others:

```tsx
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'

<ErrorBoundary><SeverityChart /></ErrorBoundary>
<ErrorBoundary><RecentActivity /></ErrorBoundary>
```

Each widget has its own `useQuery`. There is no single dashboard request that
fails all at once.

### Layout rule learned in Projects

Give every CSS grid that can contain user text an explicit column track:
`grid grid-cols-1 …` (i.e. `minmax(0,1fr)`), plus `min-w-0` on nested grids and
fieldsets. A bare `grid` creates an `auto` track that grows to the widest unbroken
string, such as a long URL or a name without spaces. In Stage 3 that made a 320 px
page 1258 px wide. Long values also need `break-words` or `break-all`. The E2E
layout test for each module should use such long values.

### 12. Frontend tests

- Unit and component tests go next to the code (`*.test.tsx`), run by `npm test`.
- Browser flows go in `frontend/e2e/`, run by `npm run e2e`. Cover:
  - keyboard use;
  - 320 px layout;
  - all three languages;
  - error states.

## Checklist

```bash
cd backend  && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest
cd frontend && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e
```

- [ ] Model imported in `app/models.py`; migration reviewed; upgrade → downgrade → upgrade works
- [ ] Router in `ROUTERS`; every route requires a session (test passes)
- [ ] Other modules use only `public.py` / `index.ts`
- [ ] List endpoints are paginated, filterable and sortable server-side, and return no large text bodies
- [ ] Page entries in `PAGES`; strings in all three locale files
- [ ] Every view has its own loading, empty and error states; widgets wrapped in `ErrorBoundary`
- [ ] Tests under `backend/tests/<name>/` and next to the frontend code
- [ ] `docs/DECISIONS.md` updated for new choices

## What not to do

- Don't add a plugin loader, module auto-discovery, an event bus or a generic CRUD framework.
- Don't split HexOps into services.
- Don't import another module's `models.py`, `service.py` or internal frontend files.
- Don't have `core`/`shared` reach into a feature.
- Don't create tables outside Alembic.
- Don't fetch all rows and filter in the browser.
