from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.core import maintenance
from app.core.config import get_settings
from app.core.errors import ErrorBody, install_error_handlers
from app.modules.activity.router import router as activity_router
from app.modules.auth.router import router as auth_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.health.router import router as health_router
from app.modules.notes.router import router as notes_router
from app.modules.pdf.jobs import recover_interrupted, sweep_expired, worker
from app.modules.pdf.router import router as pdf_router
from app.modules.projects.router import router as projects_router
from app.modules.reports.router import router as reports_router
from app.modules.reports.storage import sweep_temp_files
from app.modules.search.router import router as search_router
from app.modules.transfer import jobs as transfer_jobs
from app.modules.transfer.router import router as transfer_router

# Every module's API router, in one explicit place. Adding a module means adding
# its router here (see docs/ADDING_A_MODULE.md). Order only affects the OpenAPI listing.
ROUTERS = (
    health_router,
    auth_router,
    projects_router,
    reports_router,
    notes_router,
    activity_router,
    search_router,
    dashboard_router,
    pdf_router,
    transfer_router,
)

# Routes reachable without a session. Every other /api route must depend on
# get_current_session / require_user; tests/architecture/test_route_protection.py enforces this.
PUBLIC_ROUTES = frozenset(
    {
        ("GET", "/api/health"),
        ("POST", "/api/auth/login"),
        # First-run setup: loopback-only and closed once an account exists (D-49).
        ("GET", "/api/auth/setup"),
        ("POST", "/api/auth/setup"),
    }
)

API_SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


# Writes that a running export/import holds back. Signing in/out and the transfer
# module's own requests are not data writes.
_UNGUARDED_PREFIXES = ("/api/auth/", "/api/transfer/")


def _is_guarded_write(request: Request) -> bool:
    path = request.url.path
    return (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and path.startswith("/api/")
        and not path.startswith(_UNGUARDED_PREFIXES)
    )


def request_hostname(host_header: str) -> str:
    """'127.0.0.1:8000' -> '127.0.0.1', '[::1]:8000' -> '::1', 'Example' -> 'example'."""
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    sweep_temp_files()  # leftovers from an upload interrupted by a crash
    recover_interrupted()  # PDF jobs a previous process left unfinished (D-83)
    sweep_expired()
    worker.start()
    transfer_jobs.recover_interrupted()  # finish or undo a half-done import (D-90)
    transfer_jobs.sweep_expired()
    transfer_jobs.worker.start()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="HexOps",
        lifespan=lifespan,
        version="0.1.0",
        docs_url="/api/docs" if settings.enable_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.enable_docs else None,
    )

    allowed_hosts = frozenset(settings.allowed_hosts)

    @app.middleware("http")
    async def check_host_and_add_headers(request: Request, call_next) -> Response:  # noqa: ANN001
        # Host check first: a page on evil.example rebound to 127.0.0.1 still sends
        # "Host: evil.example", and its Origin would otherwise match "our" origin.
        if request_hostname(request.headers.get("host", "")) not in allowed_hosts:
            body = ErrorBody(detail="Host not allowed", code="invalid_host").model_dump(
                exclude_none=True
            )
            response: Response = JSONResponse(body, status_code=400)
        elif _is_guarded_write(request):
            # A full export/import holds the data still (D-90): new writes wait outside.
            if not maintenance.enter_write():
                body = ErrorBody(
                    detail="A data export or import is running", code="maintenance_in_progress"
                ).model_dump(exclude_none=True)
                response = JSONResponse(body, status_code=503, headers={"Retry-After": "10"})
            else:
                try:
                    response = await call_next(request)
                finally:
                    maintenance.leave_write()
        else:
            response = await call_next(request)
        for name, value in API_SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response

    install_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)
    return app


app = create_app()
