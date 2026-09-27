"""Guards the rule that every private route authenticates (and checks CSRF on writes).

Black-box on purpose: every operation in the OpenAPI schema is called without a
session and must answer 401, so a new router that forgets require_user fails here.
"""

import re

from app.main import PUBLIC_ROUTES, create_app


def _operations() -> set[tuple[str, str]]:
    schema = create_app().openapi()
    return {(method.upper(), path) for path, ops in schema["paths"].items() for method in ops}


def test_every_non_public_route_requires_a_session(client):
    operations = _operations()
    assert len(operations) > len(PUBLIC_ROUTES)
    unprotected = []
    for method, path in sorted(operations - PUBLIC_ROUTES):
        url = re.sub(r"\{[^}]+\}", "1", path)
        res = client.request(method, url, json={})
        if res.status_code != 401:
            unprotected.append(f"{method} {path} -> {res.status_code}")
    assert unprotected == []


def test_public_routes_exist():
    assert PUBLIC_ROUTES <= _operations()


def test_unknown_api_path_is_not_served():
    client_app = create_app()
    assert not any(p.startswith("/api/debug") for _, p in _operations())
    assert client_app.docs_url is None


MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def test_every_signed_in_write_requires_csrf_and_a_trusted_origin(logged_in):
    """With a valid session, a write without the CSRF token, or from another origin, is 403."""
    from tests.conftest import ORIGIN

    token = logged_in.cookies["hexops_csrf"]
    writes = sorted((m, p) for m, p in _operations() - PUBLIC_ROUTES if m in MUTATING)
    assert len(writes) >= 15
    unguarded = []
    for method, path in writes:
        if path == "/api/auth/logout":
            continue  # checked last: it ends the session used here
        url = re.sub(r"\{[^}]+\}", "1", path)
        no_token = logged_in.request(method, url, json={}, headers={"Origin": ORIGIN})
        foreign = logged_in.request(
            method, url, json={}, headers={"X-CSRF-Token": token, "Origin": "http://evil.example"}
        )
        if no_token.status_code != 403 or foreign.status_code != 403:
            unguarded.append(f"{method} {path} -> {no_token.status_code}/{foreign.status_code}")
    assert unguarded == []
    assert logged_in.post("/api/auth/logout", headers={"Origin": ORIGIN}).status_code == 403
