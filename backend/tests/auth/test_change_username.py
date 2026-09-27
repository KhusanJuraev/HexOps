"""Settings → Account: change the username (D-91). Always on the disposable test DB."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.main import create_app
from app.modules.auth import cli
from app.modules.auth.models import User, UserSession
from app.modules.auth.service import login_throttle
from tests.conftest import ORIGIN, PASSWORD

URL = "/api/auth/username"


def csrf(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


def rename(client: TestClient, new: str, current: str = PASSWORD):
    return client.post(
        URL, json={"new_username": new, "current_password": current}, headers=csrf(client)
    )


def field_errors(res) -> list[tuple[str, str]]:
    assert res.status_code == 422, res.text
    return [(e["field"], e["code"]) for e in res.json()["errors"]]


def account() -> tuple[int, str, str]:
    with SessionLocal() as db:
        user = db.scalar(select(User))
        return user.id, user.username, user.password_hash


def sessions() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(UserSession))


def login(client: TestClient, username: str, password: str = PASSWORD) -> int:
    return client.post(
        "/api/auth/login", json={"username": username, "password": password}
    ).status_code


def test_rename_keeps_the_account_and_signs_out_everywhere(logged_in):
    other = TestClient(create_app(), base_url="http://127.0.0.1:8000")
    assert login(other, "researcher") == 200  # a second browser
    uid, _name, hash_before = account()
    assert sessions() == 2

    res = rename(logged_in, "Red.Team_2026")
    assert res.status_code == 204
    # Cookies cleared on the response; every session revoked, both browsers signed out.
    assert 'hexops_session=""' in res.headers.get(
        "set-cookie", ""
    ) or "Max-Age=0" in res.headers.get("set-cookie", "")
    assert sessions() == 0
    assert other.get("/api/auth/me").status_code == 401
    # Same immutable id and password hash; only the (lower-cased) login name changed.
    assert account() == (uid, "red.team_2026", hash_before)

    assert login(logged_in, "researcher") == 401  # the old name is gone
    assert login(logged_in, "RED.team_2026") == 200  # the new one, any case, same password
    assert logged_in.get("/api/auth/me").json()["user"]["username"] == "red.team_2026"


def test_wrong_password_changes_nothing_and_is_throttled(logged_in):
    before = account()
    for _ in range(5):
        res = rename(logged_in, "newname", current="not my password")
        assert field_errors(res) == [("current_password", "invalid_current_password")]
    assert account() == before and sessions() == 1  # still signed in, nothing renamed
    res = rename(logged_in, "newname")
    assert res.status_code == 429 and res.json()["code"] == "rate_limited"
    assert int(res.headers["Retry-After"]) > 0
    login_throttle.reset()
    assert rename(logged_in, "newname").status_code == 204


@pytest.mark.parametrize(
    ("new", "code"),
    [
        ("researcher", "username_unchanged"),
        ("ReSeArChEr", "username_unchanged"),  # case only: stored lower-cased, so unchanged
        ("ab", "string_pattern_mismatch"),
        ("has space", "string_pattern_mismatch"),
        ("x" * 65, "string_pattern_mismatch"),
        ("üser", "string_pattern_mismatch"),
        ("../admin", "string_pattern_mismatch"),
    ],
)
def test_invalid_or_unchanged_names_are_field_errors(logged_in, new, code):
    before = account()
    assert field_errors(rename(logged_in, new)) == [("new_username", code)]
    assert account() == before and sessions() == 1


def test_missing_fields_and_extras_are_refused(logged_in):
    res = logged_in.post(URL, json={"new_username": "newname"}, headers=csrf(logged_in))
    assert ("current_password", "missing") in field_errors(res)
    res = logged_in.post(
        URL,
        json={"new_username": "newname", "current_password": PASSWORD, "admin": True},
        headers=csrf(logged_in),
    )
    assert res.status_code == 422


def test_needs_session_csrf_and_trusted_origin(client, logged_in):
    assert client.post(URL, json={"new_username": "x1x", "current_password": "x"}).status_code in (
        401,
        403,
    )
    fresh = TestClient(create_app(), base_url="http://127.0.0.1:8000")
    assert (
        fresh.post(URL, json={"new_username": "newname", "current_password": PASSWORD}).status_code
        == 401
    )
    body = {"new_username": "newname", "current_password": PASSWORD}
    assert logged_in.post(URL, json=body, headers={"Origin": ORIGIN}).status_code == 403  # no token
    evil = {"X-CSRF-Token": logged_in.cookies["hexops_csrf"], "Origin": "http://evil.example"}
    assert logged_in.post(URL, json=body, headers=evil).status_code == 403
    assert account()[1] == "researcher"


def test_the_password_is_never_echoed_or_logged(logged_in, caplog):
    caplog.set_level(logging.DEBUG)
    secret = "wrong but secret passphrase"
    res = rename(logged_in, "newname", current=secret)
    assert secret not in res.text and secret not in caplog.text
    res = rename(logged_in, "newname")
    assert PASSWORD not in res.text and PASSWORD not in caplog.text


def test_history_follows_the_account_not_the_old_name(logged_in):
    pid = logged_in.post(
        "/api/projects", json={"name": "Acme", "type": "bounty_program"}, headers=csrf(logged_in)
    ).json()["id"]
    before = logged_in.get("/api/activity").json()["items"]
    assert {e["actor"] for e in before} == {"researcher"}
    assert rename(logged_in, "hunter").status_code == 204
    assert login(logged_in, "hunter") == 200
    after = logged_in.get("/api/activity").json()["items"]
    # Same events, not orphaned; they show the account's current name.
    assert [e["id"] for e in after] == [e["id"] for e in before]
    assert {e["actor"] for e in after} == {"hunter"}
    assert logged_in.get(f"/api/projects/{pid}").status_code == 200


def test_cli_recovery_uses_the_new_name(logged_in, monkeypatch, capsys):
    assert rename(logged_in, "hunter").status_code == 204
    new_password = "a recovered passphrase 2026"
    answers = iter([new_password, new_password])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["set-password", "researcher"])  # the old name no longer exists
    assert "No user named 'researcher'" in str(exit_info.value)
    cli.main(["set-password", "Hunter"])
    assert "Password updated for 'hunter'" in capsys.readouterr().out
    assert login(logged_in, "hunter", new_password) == 200


def test_export_and_import_after_a_rename(logged_in):
    from tests.transfer.conftest import apply as apply_import
    from tests.transfer.conftest import check, export, fill, snapshot, wait_job, wipe_data

    fill(logged_in)
    assert rename(logged_in, "hunter").status_code == 204
    assert login(logged_in, "hunter") == 200
    before = snapshot(logged_in)
    job, data = export(logged_in)
    wipe_data()
    checked = check(logged_in, data)
    assert checked["preview"]["source"]["source_owner"] == "hunter"  # the name at export time
    assert apply_import(logged_in, checked["id"]).status_code == 202
    assert wait_job(logged_in, checked["id"])["status"] == "done"
    assert snapshot(logged_in) == before
    assert {e["actor"] for e in logged_in.get("/api/activity?size=100").json()["items"]} == {
        "hunter"
    }
