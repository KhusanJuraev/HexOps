from fastapi import Depends, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings, is_loopback
from app.core.db import get_db
from app.core.errors import api_error
from app.core.security import digests_match, token_digest
from app.modules.auth.models import User, UserSession
from app.modules.auth.service import resolve_session

SESSION_COOKIE = "hexops_session"
CSRF_COOKIE = "hexops_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def check_origin(request: Request) -> None:
    """Reject cross-site state-changing requests based on Origin/Referer.

    A defence-in-depth layer in front of the session-bound CSRF token; it also
    protects the login endpoint, which has no session yet.
    """
    if request.method in SAFE_METHODS:
        return
    origin = request.headers.get("origin")
    if origin is None:
        referer = request.headers.get("referer")
        if referer:
            scheme, _, rest = referer.partition("://")
            origin = f"{scheme}://{rest.split('/', 1)[0]}"
    if origin is None:
        # Non-browser clients (curl, tests) send neither header; browsers always
        # send Origin on cross-origin POST/PUT/PATCH/DELETE.
        return
    own_origin = f"{request.url.scheme}://{request.url.netloc}"
    if origin.rstrip("/") not in {own_origin, *get_settings().trusted_origins}:
        raise api_error(status.HTTP_403_FORBIDDEN, "untrusted_origin", "Untrusted request origin")


def _client_hops(request: Request) -> list[str]:
    """The direct peer plus every address a proxy recorded for this request."""
    hops = [request.client.host if request.client else ""]
    for value in request.headers.getlist("x-forwarded-for"):
        hops.extend(part for part in value.split(","))
    for value in request.headers.getlist("forwarded"):
        for element in value.replace(";", ",").split(","):
            key, _, addr = element.strip().partition("=")
            if key.lower() == "for":
                hops.append(addr.strip('"'))
    return [h.strip() for h in hops]


def _origin_host(request: Request) -> str:
    origin = request.headers.get("origin", "")
    scheme, _, rest = origin.partition("://")
    host = rest.split("/", 1)[0]
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def require_loopback_client(request: Request) -> None:
    """Allow the request only if it comes from this machine, directly or via a local proxy.

    Three independent checks, all required (D-49, D-51):
    1. The direct peer is loopback. uvicorn runs with proxy_headers=False, so this is
       the real TCP peer, never a value taken from a header.
    2. Every X-Forwarded-For / Forwarded hop is loopback. Behind the Vite dev server
       every request arrives from 127.0.0.1; Vite (xfwd) appends the real client, so
       a remote client cannot pass by prepending "127.0.0.1". Unparseable hops deny.
    3. The browser's Origin is present and names a loopback host. Proxies pass Origin
       through untouched, so a LAN browser is refused even behind a proxy that
       forgets X-Forwarded-For (e.g. nginx defaults). The HexOps UI always sends it.
    Assumption: any proxy in front of the API is on this machine and appends
    X-Forwarded-For (check 2); check 3 covers browsers when it does not.
    """
    local = all(is_loopback(hop) for hop in _client_hops(request))
    if not local or not is_loopback(_origin_host(request)):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "setup_local_only",
            "First-run setup is only allowed from the machine running HexOps",
        )


def get_current_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    token = request.cookies.get(SESSION_COOKIE)
    record = resolve_session(db, token) if token else None
    if record is None:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "not_authenticated", "Not authenticated")

    if request.method not in SAFE_METHODS:
        check_origin(request)
        header = request.headers.get(CSRF_HEADER, "")
        if not header or not digests_match(token_digest(header), record.csrf_hash):
            raise api_error(
                status.HTTP_403_FORBIDDEN, "csrf_failed", "CSRF token missing or invalid"
            )

    request.state.session = record
    return record


def require_user(record: UserSession = Depends(get_current_session)) -> User:
    """Attach to every private router: authenticates and, for writes, checks CSRF."""
    return record.user
