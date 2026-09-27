"""Every error response uses one envelope: {"detail", "code", "errors"?}."""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.db import get_db
from app.main import create_app
from tests.conftest import ORIGIN


def assert_envelope(res, status: int, code: str) -> dict:
    assert res.status_code == status, res.text
    body = res.json()
    assert body["code"] == code
    assert isinstance(body["detail"], str) and body["detail"]
    return body


def test_validation_errors_are_field_level_and_do_not_echo_input(client):
    res = client.post("/api/auth/login", json={"username": "a", "password": "", "admin": True})
    body = assert_envelope(res, 422, "validation_error")
    by_field = {e["field"]: e for e in body["errors"]}
    assert by_field["username"]["code"] == "string_pattern_mismatch"
    assert by_field["password"]["code"] == "string_too_short"
    assert by_field["password"]["params"] == {"min_length": 1}
    assert by_field["admin"]["code"] == "extra_forbidden"
    assert "input" not in res.text


def test_missing_fields_and_malformed_json(client):
    body = assert_envelope(client.post("/api/auth/login", json={}), 422, "validation_error")
    assert {(e["field"], e["code"]) for e in body["errors"]} == {
        ("username", "missing"),
        ("password", "missing"),
    }
    res = client.post(
        "/api/auth/login", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert_envelope(res, 422, "validation_error")


def test_auth_errors_carry_specific_codes(client, user, logged_in):
    assert_envelope(logged_in.post("/api/auth/logout"), 403, "csrf_failed")
    res = logged_in.post(
        "/api/auth/logout",
        headers={
            "X-CSRF-Token": logged_in.cookies["hexops_csrf"],
            "Origin": "https://evil.example",
        },
    )
    assert_envelope(res, 403, "untrusted_origin")
    logged_in.cookies.clear()
    assert_envelope(client.get("/api/auth/me"), 401, "not_authenticated")
    bad = client.post("/api/auth/login", json={"username": "researcher", "password": "nope"})
    assert_envelope(bad, 401, "invalid_credentials")


def test_rate_limit_error_keeps_retry_after(client, user):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "researcher", "password": "nope"})
    res = client.post("/api/auth/login", json={"username": "researcher", "password": "nope"})
    assert_envelope(res, 429, "rate_limited")
    assert int(res.headers["retry-after"]) > 0


def test_framework_errors_use_the_envelope(client):
    assert_envelope(client.get("/api/nope"), 404, "not_found")
    assert_envelope(client.get("/api/auth/login"), 405, "method_not_allowed")


def test_unhandled_exception_is_generic_500():
    app = create_app()

    @app.get("/api/boom")
    def boom() -> None:
        raise RuntimeError("secret detail must not leak")

    with TestClient(app, base_url=ORIGIN, raise_server_exceptions=False) as c:
        res = c.get("/api/boom")
    assert_envelope(res, 500, "internal_error")
    assert "secret" not in res.text


def test_health_reports_database_outage_as_503():
    app = create_app()
    broken = MagicMock()
    broken.execute.side_effect = OperationalError("SELECT 1", {}, Exception("down"))
    app.dependency_overrides[get_db] = lambda: broken
    with TestClient(app, base_url=ORIGIN) as c:
        res = c.get("/api/health")
    assert_envelope(res, 503, "database_unavailable")


def test_database_outage_on_private_route_is_503_not_500(monkeypatch):
    from app.modules.auth import deps

    def refuse(*_args, **_kwargs):
        raise OperationalError("SELECT", {}, Exception("connection refused"))

    monkeypatch.setattr(deps, "resolve_session", refuse)
    with TestClient(create_app(), base_url=ORIGIN, raise_server_exceptions=False) as c:
        c.cookies.set("hexops_session", "x")
        res = c.get("/api/auth/me")
    assert_envelope(res, 503, "database_unavailable")
    assert "refused" not in res.text
