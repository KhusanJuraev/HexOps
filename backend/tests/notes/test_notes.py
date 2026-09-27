"""Stage 5: notes CRUD, tags, filters, optional project link, activity, migration."""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import inspect, select

from alembic import command
from app.core.db import SessionLocal, engine
from app.modules.notes.models import Tag
from tests.conftest import ORIGIN, _test_url


def w(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


BODY = (
    "# Recon\n\n| host | port |\n|---|---|\n| a | 443 |\n\n"
    "```bash\nnmap -sV a\n```\n<script>alert(1)</script>"
)


def note(**overrides) -> dict:
    return {
        "title": "Recon notes",
        "body_md": BODY,
        "project_id": None,
        "tags": ["recon"],
        **overrides,
    }


@pytest.fixture
def project(logged_in) -> int:
    return logged_in.post(
        "/api/projects", json={"name": "Acme", "type": "bounty_program"}, headers=w(logged_in)
    ).json()["id"]


@pytest.fixture
def make(logged_in):
    def make(**overrides) -> dict:
        res = logged_in.post("/api/notes", json=note(**overrides), headers=w(logged_in))
        assert res.status_code == 201, res.text
        return res.json()

    return make


def errors(res) -> dict[str, str]:
    assert res.status_code == 422, res.text
    return {e["field"]: e["code"] for e in res.json()["errors"]}


def history(client, note_id: int) -> list[dict]:
    items = client.get(
        "/api/activity", params={"entity_type": "note", "entity_id": note_id}
    ).json()["items"]
    return list(reversed(items))


# --- auth ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/notes"),
        ("POST", "/api/notes"),
        ("GET", "/api/notes/tags"),
        ("GET", "/api/notes/1"),
        ("PUT", "/api/notes/1"),
        ("DELETE", "/api/notes/1"),
    ],
)
def test_every_route_requires_a_session(client, method, path):
    assert client.request(method, path).status_code == 401


def test_writes_require_csrf(logged_in, make):
    n = make()
    assert logged_in.post("/api/notes", json=note()).json()["code"] == "csrf_failed"
    assert logged_in.put(f"/api/notes/{n['id']}", json=note(title="x")).status_code == 403
    assert logged_in.delete(f"/api/notes/{n['id']}").status_code == 403
    assert logged_in.get(f"/api/notes/{n['id']}").json()["title"] == "Recon notes"


# --- CRUD -----------------------------------------------------------------------------


def test_create_read_keeps_markdown_exactly(logged_in, make):
    n = make()
    assert n["body_md"] == BODY  # stored as typed; rendering is the frontend's job
    assert n["project_id"] is None and n["project_name"] is None
    assert logged_in.get(f"/api/notes/{n['id']}").json() == n


def test_optional_project_link(logged_in, make, project):
    linked = make(project_id=project)
    assert (linked["project_id"], linked["project_name"]) == (project, "Acme")
    unlinked = logged_in.put(
        f"/api/notes/{linked['id']}", json=note(project_id=None), headers=w(logged_in)
    ).json()
    assert unlinked["project_id"] is None
    assert errors(
        logged_in.post("/api/notes", json=note(project_id=999999), headers=w(logged_in))
    ) == {"project_id": "project_not_found"}


def test_deleting_a_project_keeps_its_notes_unlinked(logged_in, make, project):
    n = make(project_id=project)
    assert logged_in.delete(f"/api/projects/{project}", headers=w(logged_in)).status_code == 204
    got = logged_in.get(f"/api/notes/{n['id']}").json()
    assert got["project_id"] is None and got["body_md"] == BODY


def test_update_and_delete(logged_in, make):
    n = make()
    got = logged_in.put(
        f"/api/notes/{n['id']}",
        json=note(title="  Renamed  ", body_md="new", tags=["todo"]),
        headers=w(logged_in),
    ).json()
    assert (got["title"], got["body_md"], got["tags"]) == ("Renamed", "new", ["todo"])
    assert got["updated_at"] > got["created_at"]
    assert logged_in.delete(f"/api/notes/{n['id']}", headers=w(logged_in)).status_code == 204
    assert logged_in.get(f"/api/notes/{n['id']}").json()["code"] == "note_not_found"
    assert logged_in.get("/api/notes/0").status_code == 422


def test_activity_records_create_edit_delete_with_actor(logged_in, make, project):
    n = make(project_id=project)
    logged_in.put(
        f"/api/notes/{n['id']}", json=note(project_id=project), headers=w(logged_in)
    )  # no change
    logged_in.put(
        f"/api/notes/{n['id']}",
        json=note(project_id=project, title="T2", tags=["recon", "todo"]),
        headers=w(logged_in),
    )
    logged_in.delete(f"/api/notes/{n['id']}", headers=w(logged_in))
    events = history(logged_in, n["id"])
    assert [(e["action"], e["details"]) for e in events] == [
        ("note.created", {"title": "Recon notes"}),
        ("note.updated", {"fields": ["title", "tags"]}),
        ("note.deleted", {"title": "T2"}),
    ]
    assert all(e["actor"] == "researcher" and e["project_id"] == project for e in events)
    assert BODY not in str(events)  # never the body


# --- tags ------------------------------------------------------------------------------


def test_tags_are_normalized_and_deduplicated(make):
    n = make(tags=["  Recon ", "recon", "Cheat-Sheet", "todo", "разведка", "OʻZBEK_2"])
    assert n["tags"] == sorted(["recon", "cheat-sheet", "todo", "разведка", "oʻzbek_2"])


@pytest.mark.parametrize(
    "bad", ["two words", "#hash", "-leading", "_x", "", "x" * 33, "a/b", "tag!"]
)
def test_invalid_tags_are_rejected(logged_in, bad):
    res = logged_in.post("/api/notes", json=note(tags=["ok", bad]), headers=w(logged_in))
    assert errors(res) == {"tags": "tag_invalid"}


def test_too_many_tags(logged_in):
    assert errors(
        logged_in.post(
            "/api/notes", json=note(tags=[f"t{i}" for i in range(21)]), headers=w(logged_in)
        )
    ) == {"tags": "too_long"}


def test_tag_list_counts_and_unused_tags_disappear(logged_in, make):
    a = make(tags=["recon", "todo"])
    make(tags=["recon"])
    assert logged_in.get("/api/notes/tags").json() == [
        {"name": "recon", "count": 2},
        {"name": "todo", "count": 1},
    ]
    logged_in.put(f"/api/notes/{a['id']}", json=note(tags=["recon"]), headers=w(logged_in))
    assert [t["name"] for t in logged_in.get("/api/notes/tags").json()] == ["recon"]
    with SessionLocal() as db:
        assert sorted(db.scalars(select(Tag.name))) == ["recon"]


# --- validation ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"title": "  "}, {"title": "string_too_short"}),
        ({"title": "x" * 301}, {"title": "string_too_long"}),
        ({"body_md": "x" * 200_001}, {"body_md": "string_too_long"}),
        ({"project_id": 0}, {"project_id": "greater_than"}),
        ({"pinned": True}, {"pinned": "extra_forbidden"}),
    ],
)
def test_invalid_input(logged_in, overrides, expected):
    assert (
        errors(logged_in.post("/api/notes", json=note(**overrides), headers=w(logged_in)))
        == expected
    )


# --- list ------------------------------------------------------------------------------------


@pytest.fixture
def many(logged_in, make, project):
    make(
        title="Alpha recon", tags=["recon", "todo"], project_id=project, body_md="subdomains found"
    )
    make(title="bravo cheat sheet", tags=["cheat-sheet"], body_md="sqlmap -u 100% payload")
    make(title="Charlie", tags=["recon"], body_md="nothing")
    make(title="delta_todo", tags=["todo"], project_id=project, body_md="write report")
    return logged_in


def titles(client, **params) -> list[str]:
    res = client.get("/api/notes", params=params)
    assert res.status_code == 200, res.text
    return [n["title"] for n in res.json()["items"]]


def test_list_has_no_bodies(many):
    item = many.get("/api/notes").json()["items"][0]
    assert "body_md" not in item and {"id", "title", "tags", "project_name"} <= set(item)


def test_tag_and_keyword_filters(many, project):
    assert titles(many, tag="recon", sort="title", order="asc") == ["Alpha recon", "Charlie"]
    assert titles(many, tag=["recon", "todo"]) == ["Alpha recon"]  # AND
    assert titles(many, tag="TODO", sort="title", order="asc") == [
        "Alpha recon",
        "delta_todo",
    ]  # normalized
    assert titles(many, q="subdomains") == ["Alpha recon"]  # body match
    assert titles(many, q="CHEAT") == ["bravo cheat sheet"]  # title, case-insensitive
    assert titles(many, q="100%") == ["bravo cheat sheet"]  # LIKE wildcards are literal
    assert titles(many, q="_todo") == ["delta_todo"]
    assert titles(many, project_id=project, sort="title", order="asc") == [
        "Alpha recon",
        "delta_todo",
    ]
    assert titles(many, tag="missing") == []


def test_sorting_and_pagination(many):
    assert titles(many, sort="title", order="asc") == [
        "Alpha recon",
        "bravo cheat sheet",
        "Charlie",
        "delta_todo",
    ]
    assert titles(many, sort="created_at", order="desc")[0] == "delta_todo"
    page2 = many.get(
        "/api/notes", params={"size": 3, "page": 2, "sort": "title", "order": "asc"}
    ).json()
    assert page2["total"] == 4 and [n["title"] for n in page2["items"]] == ["delta_todo"]


@pytest.mark.parametrize(
    "params",
    [{"size": 101}, {"sort": "body_md"}, {"tag": "bad tag"}, {"project_id": 0}, {"extra": 1}],
)
def test_bad_list_parameters(logged_in, params):
    assert logged_in.get("/api/notes", params=params).status_code == 422


# --- migration ---------------------------------------------------------------------------------


def test_migration_0005_down_and_up_keeps_other_data(logged_in, project):
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    command.downgrade(cfg, "0004")
    try:
        assert not {"notes", "tags", "note_tags"} & set(inspect(engine).get_table_names())
    finally:
        command.upgrade(cfg, "head")
    assert {"notes", "tags", "note_tags"} <= set(inspect(engine).get_table_names())
    assert logged_in.get(f"/api/projects/{project}").json()["name"] == "Acme"
    fks = {
        f["referred_table"]: f["options"].get("ondelete")
        for f in inspect(engine).get_foreign_keys("notes")
    }
    assert fks == {"projects": "SET NULL"}
