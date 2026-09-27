"""Settings → Security: change password with the current one; sign out everywhere."""

import logging

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.main import create_app
from app.modules.auth.models import User, UserSession
from tests.conftest import ORIGIN, PASSWORD

NEW = "a completely new passphrase"
URL = "/api/auth/password"


def csrf(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


def change(client: TestClient, current: str = PASSWORD, new: str = NEW, confirm: str | None = None):
    body = {
        "current_password": current,
        "new_password": new,
        "new_password_confirm": confirm or new,
    }
    return client.post(URL, json=body, headers=csrf(client))


def field_errors(res) -> list[tuple[str, str]]:
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "validation_error"
    return [(e["field"], e["code"]) for e in res.json()["errors"]]


def stored_hash() -> str:
    with SessionLocal() as db:
        return db.scalar(select(User.password_hash))


def session_count() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(UserSession))


def login(client: TestClient, password: str) -> int:
    return client.post(
        "/api/auth/login", json={"username": "researcher", "password": password}
    ).status_code


# --- access control -------------------------------------------------------------


def test_requires_a_session(client, user):
    res = client.post(
        URL, json={"current_password": PASSWORD, "new_password": NEW, "new_password_confirm": NEW}
    )
    assert res.status_code == 401
    assert res.json()["code"] == "not_authenticated"


def test_requires_csrf_token(logged_in):
    body = {"current_password": PASSWORD, "new_password": NEW, "new_password_confirm": NEW}
    assert logged_in.post(URL, json=body).json()["code"] == "csrf_failed"
    forged = logged_in.post(URL, json=body, headers={"X-CSRF-Token": "forged"})
    assert forged.status_code == 403
    cross_site = logged_in.post(
        URL,
        json=body,
        headers={
            "X-CSRF-Token": logged_in.cookies["hexops_csrf"],
            "Origin": "https://evil.example",
        },
    )
    assert cross_site.json()["code"] == "untrusted_origin"
    assert login(logged_in, PASSWORD) == 200  # unchanged


# --- failures keep the session ---------------------------------------------------


def test_wrong_current_password(logged_in):
    before = stored_hash()
    res = change(logged_in, current="not my password")
    assert field_errors(res) == [("current_password", "invalid_current_password")]
    assert stored_hash() == before
    assert logged_in.get("/api/auth/me").status_code == 200  # still signed in


def test_confirmation_mismatch(logged_in):
    res = change(logged_in, confirm=NEW + "!")
    assert field_errors(res) == [("new_password_confirm", "password_mismatch")]
    assert logged_in.get("/api/auth/me").status_code == 200


def test_new_password_too_short(logged_in):
    res = change(logged_in, new="short1", confirm="short1")
    assert ("new_password", "string_too_short") in field_errors(res)


def test_reusing_the_current_password_is_rejected(logged_in):
    before = stored_hash()
    res = change(logged_in, new=PASSWORD)
    assert field_errors(res) == [("new_password", "password_reused")]
    assert stored_hash() == before
    assert logged_in.get("/api/auth/me").status_code == 200


def test_wrong_current_password_is_throttled(logged_in):
    for _ in range(5):
        change(logged_in, current="guess")
    res = change(logged_in)  # even the right one is refused while locked
    assert res.status_code == 429
    assert res.json()["code"] == "rate_limited"
    assert int(res.headers["retry-after"]) > 0
    assert logged_in.get("/api/auth/me").status_code == 200


# --- success ----------------------------------------------------------------------


def test_success_changes_password_and_revokes_every_session(logged_in, caplog):
    caplog.set_level(logging.DEBUG)
    # A second, independent session (another browser or device).
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as other:
        assert login(other, PASSWORD) == 200
        assert session_count() == 2
        before = stored_hash()

        res = change(logged_in)
        assert res.status_code == 204
        assert res.content == b""

        # The current session's cookies are cleared, and the sessions are gone server-side.
        cleared = " ".join(res.headers.get_list("set-cookie"))
        assert "hexops_session=" in cleared and "Max-Age=0" in cleared
        assert session_count() == 0
        assert other.get("/api/auth/me").status_code == 401

    old_cookie_client = logged_in
    assert old_cookie_client.get("/api/auth/me").status_code == 401

    after = stored_hash()
    assert after != before and after.startswith("$argon2id$")
    for secret in (PASSWORD, NEW):
        assert secret not in after
        assert secret not in caplog.text
        assert secret not in res.text

    logged_in.cookies.clear()
    assert login(logged_in, PASSWORD) == 401  # old password rejected
    assert login(logged_in, NEW) == 200  # new password works


def test_replayed_old_session_cookie_is_rejected(logged_in):
    token = logged_in.cookies["hexops_session"]
    assert change(logged_in).status_code == 204
    logged_in.cookies.set("hexops_session", token)
    assert logged_in.get("/api/auth/me").status_code == 401
