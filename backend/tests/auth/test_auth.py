from datetime import timedelta

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import token_digest
from app.modules.auth.models import UserSession
from app.modules.auth.service import utcnow
from tests.conftest import ORIGIN, PASSWORD


def csrf(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"]}


def test_health_is_public(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["cache-control"] == "no-store"


def test_login_sets_httponly_session_cookie(client, user):
    res = client.post("/api/auth/login", json={"username": "RESEARCHER", "password": PASSWORD})
    assert res.status_code == 200
    assert res.json()["user"]["username"] == "researcher"
    assert "password_hash" not in res.text

    set_cookies = res.headers.get_list("set-cookie")
    session_cookie = next(c for c in set_cookies if c.startswith("hexops_session="))
    csrf_cookie = next(c for c in set_cookies if c.startswith("hexops_csrf="))
    assert "HttpOnly" in session_cookie
    assert "SameSite=strict" in session_cookie
    assert "HttpOnly" not in csrf_cookie


def test_session_token_is_not_stored_in_plaintext(logged_in):
    token = logged_in.cookies["hexops_session"]
    with SessionLocal() as db:
        record = db.scalar(select(UserSession))
    assert record.token_hash == token_digest(token)
    assert token not in (record.token_hash, record.csrf_hash)


def test_wrong_password_and_unknown_user_look_identical(client, user):
    a = client.post("/api/auth/login", json={"username": "researcher", "password": "nope"})
    b = client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()
    assert "hexops_session" not in client.cookies


def test_login_validation_rejects_bad_input(client):
    res = client.post("/api/auth/login", json={"username": "../etc", "password": "x"})
    assert res.status_code == 422
    res = client.post("/api/auth/login", json={"username": "abc", "password": "x", "admin": True})
    assert res.status_code == 422


def test_login_is_throttled_after_repeated_failures(client, user):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "researcher", "password": "wrong"})
    res = client.post("/api/auth/login", json={"username": "researcher", "password": PASSWORD})
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) > 0


def test_login_rejects_cross_site_origin(client, user):
    res = client.post(
        "/api/auth/login",
        json={"username": "researcher", "password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert res.status_code == 403


def test_me_requires_session(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_current_user(logged_in):
    res = logged_in.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["user"]["username"] == "researcher"


def test_logout_requires_csrf_token(logged_in):
    assert logged_in.post("/api/auth/logout").status_code == 403
    bad = logged_in.post("/api/auth/logout", headers={"X-CSRF-Token": "forged"})
    assert bad.status_code == 403
    assert logged_in.get("/api/auth/me").status_code == 200


def test_logout_rejects_trusted_token_from_untrusted_origin(logged_in):
    res = logged_in.post(
        "/api/auth/logout", headers={**csrf(logged_in), "Origin": "https://evil.example"}
    )
    assert res.status_code == 403


def test_logout_revokes_session(logged_in):
    token = logged_in.cookies["hexops_session"]
    res = logged_in.post("/api/auth/logout", headers={**csrf(logged_in), "Origin": ORIGIN})
    assert res.status_code == 204
    # The server-side record is gone, so replaying the old cookie fails.
    logged_in.cookies.set("hexops_session", token)
    assert logged_in.get("/api/auth/me").status_code == 401


def test_expired_session_is_rejected_and_deleted(logged_in):
    with SessionLocal() as db:
        record = db.scalar(select(UserSession))
        record.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert logged_in.get("/api/auth/me").status_code == 401
    with SessionLocal() as db:
        assert db.scalar(select(UserSession)) is None


def test_idle_session_is_rejected(logged_in):
    with SessionLocal() as db:
        record = db.scalar(select(UserSession))
        record.last_seen_at = utcnow() - timedelta(hours=25)
        db.commit()
    assert logged_in.get("/api/auth/me").status_code == 401


def test_the_production_preview_origin_is_trusted_by_default(client, user):
    """`npm run preview` serves the built UI on 127.0.0.1:4173; its writes must work."""
    from tests.conftest import PASSWORD

    res = client.post(
        "/api/auth/login",
        json={"username": "researcher", "password": PASSWORD},
        headers={"Origin": "http://127.0.0.1:4173"},
    )
    assert res.status_code == 200
    res = client.post(
        "/api/projects",
        json={"name": "From preview", "type": "bounty_program"},
        headers={"Origin": "http://127.0.0.1:4173", "X-CSRF-Token": client.cookies["hexops_csrf"]},
    )
    assert res.status_code == 201
