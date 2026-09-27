"""Stage 3: Projects CRUD, structured scope, list queries, activity, auth."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import SessionLocal, engine
from app.main import create_app
from app.modules.activity.models import ActivityLog
from app.modules.projects.models import ScopeItem
from tests.conftest import ORIGIN

SCOPE = [
    {"kind": "wildcard", "value": "*.Example.com", "note": "main program"},
    {"kind": "domain", "value": "api.example.com", "note": ""},
    {"kind": "url", "value": "https://app.example.com:8443/login?next=/", "note": "SSO"},
    {"kind": "ip", "value": "2001:db8::10", "note": ""},
    {"kind": "cidr", "value": "10.20.0.0/16", "note": "VPN range"},
    {"kind": "other", "value": "Mobile app com.example.android (v5+)", "note": ""},
]


def body(**overrides) -> dict:
    return {
        "name": "Example Corp",
        "type": "bounty_program",
        "status": "active",
        "start_date": "2026-09-01",
        "description": "Public program.",
        "scope": SCOPE,
        **overrides,
    }


def w(client: TestClient) -> dict[str, str]:
    """Headers for a state-changing request: CSRF token + trusted Origin."""
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


def create(client: TestClient, **overrides) -> dict:
    res = client.post("/api/projects", json=body(**overrides), headers=w(client))
    assert res.status_code == 201, res.text
    return res.json()


def errors(res) -> dict[str, str]:
    assert res.status_code == 422, res.text
    return {e["field"]: e["code"] for e in res.json()["errors"]}


def activity(client: TestClient, project_id: int) -> list[dict]:
    res = client.get("/api/activity", params={"project_id": project_id, "size": 100})
    assert res.status_code == 200
    return res.json()["items"]


# --- auth -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/projects"),
        ("POST", "/api/projects"),
        ("GET", "/api/projects/1"),
        ("PUT", "/api/projects/1"),
        ("DELETE", "/api/projects/1"),
        ("GET", "/api/activity"),
    ],
)
def test_every_route_requires_a_session(client, method, path):
    res = client.request(method, path, json=body())
    assert res.status_code == 401


def test_writes_require_csrf_and_trusted_origin(logged_in):
    assert logged_in.post("/api/projects", json=body()).json()["code"] == "csrf_failed"
    project = create(logged_in)
    pid = project["id"]
    assert logged_in.put(f"/api/projects/{pid}", json=body(name="X")).status_code == 403
    assert logged_in.delete(f"/api/projects/{pid}").status_code == 403
    evil = {**w(logged_in), "Origin": "https://evil.example"}
    assert (
        logged_in.delete(f"/api/projects/{pid}", headers=evil).json()["code"] == "untrusted_origin"
    )
    assert logged_in.get(f"/api/projects/{pid}").json()["name"] == "Example Corp"


# --- CRUD & scope -----------------------------------------------------------------


def test_create_read_keeps_scope_order_and_exact_values(logged_in):
    project = create(logged_in)
    assert project["scope"] == SCOPE
    got = logged_in.get(f"/api/projects/{project['id']}").json()
    assert got["scope"] == SCOPE
    assert got["name"] == "Example Corp"
    assert got["type"] == "bounty_program" and got["status"] == "active"
    assert got["start_date"] == "2026-09-01"
    with SessionLocal() as db:
        rows = db.scalars(select(ScopeItem).order_by(ScopeItem.position)).all()
    assert [(r.position, r.value) for r in rows] == [(i, s["value"]) for i, s in enumerate(SCOPE)]


def test_name_is_trimmed_but_scope_values_are_never_changed(logged_in):
    project = create(
        logged_in, name="  Padded name  ", scope=[{"kind": "domain", "value": "MiXeD.Example.COM"}]
    )
    assert project["name"] == "Padded name"
    assert project["scope"] == [{"kind": "domain", "value": "MiXeD.Example.COM", "note": ""}]


def test_update_replaces_fields_and_reorders_scope(logged_in):
    pid = create(logged_in)["id"]
    reordered = list(reversed(SCOPE[:3]))
    res = logged_in.put(
        f"/api/projects/{pid}",
        json=body(
            name="Renamed", type="pentest_client", start_date=None, description="", scope=reordered
        ),
        headers=w(logged_in),
    )
    assert res.status_code == 200, res.text
    got = res.json()
    assert (got["name"], got["type"], got["start_date"], got["description"]) == (
        "Renamed",
        "pentest_client",
        None,
        "",
    )
    assert got["scope"] == reordered
    assert got["updated_at"] > got["created_at"]


def test_delete_removes_project_and_scope(logged_in):
    pid = create(logged_in)["id"]
    assert logged_in.delete(f"/api/projects/{pid}", headers=w(logged_in)).status_code == 204
    assert logged_in.get(f"/api/projects/{pid}").json()["code"] == "project_not_found"
    assert logged_in.delete(f"/api/projects/{pid}", headers=w(logged_in)).status_code == 404
    with SessionLocal() as db:
        assert db.scalars(select(ScopeItem)).all() == []


def test_missing_project_and_bad_ids(logged_in):
    assert logged_in.get("/api/projects/999999").status_code == 404
    assert (
        logged_in.put("/api/projects/999999", json=body(), headers=w(logged_in)).status_code == 404
    )
    assert logged_in.get("/api/projects/0").status_code == 422
    assert logged_in.get("/api/projects/abc").status_code == 422
    assert logged_in.get("/api/projects/99999999999").status_code == 422


def test_persists_across_an_application_restart(logged_in):
    pid = create(logged_in)["id"]
    engine.dispose()  # drop every pooled connection, as a process restart would
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as fresh:
        assert (
            fresh.post(
                "/api/auth/login",
                json={"username": "researcher", "password": "correct horse battery staple"},
            ).status_code
            == 200
        )
        got = fresh.get(f"/api/projects/{pid}").json()
    assert got["scope"] == SCOPE and got["name"] == "Example Corp"


# --- validation --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field", "code"),
    [
        ({"name": "   "}, "name", "string_too_short"),
        ({"name": "x" * 201}, "name", "string_too_long"),
        ({"type": "hobby"}, "type", "enum"),
        ({"status": "archived"}, "status", "enum"),
        ({"start_date": "2026-02-30"}, "start_date", "date_from_datetime_parsing"),
        ({"start_date": "1900-01-01"}, "start_date", "date_out_of_range"),
        ({"description": "x" * 10_001}, "description", "string_too_long"),
        ({"owner": "me"}, "owner", "extra_forbidden"),
    ],
)
def test_invalid_project_fields(logged_in, overrides, field, code):
    got = errors(logged_in.post("/api/projects", json=body(**overrides), headers=w(logged_in)))
    assert got == {field: code}


@pytest.mark.parametrize(
    ("kind", "value", "code"),
    [
        ("domain", " example.com", "scope_value_whitespace"),
        ("domain", "example.com\n", "scope_value_whitespace"),
        ("domain", "exa\x00mple.com", "scope_value_control_chars"),
        ("domain", "localhost", "scope_invalid_domain"),
        ("domain", "-bad.example.com", "scope_invalid_domain"),
        ("domain", "*.example.com", "scope_invalid_domain"),
        ("wildcard", "example.com", "scope_invalid_wildcard"),
        ("wildcard", "*example.com", "scope_invalid_wildcard"),
        ("url", "example.com/login", "scope_invalid_url"),
        ("url", "ftp://example.com", "scope_invalid_url"),
        ("url", "https://exa mple.com", "scope_invalid_url"),
        ("url", "https://example.com:99999", "scope_invalid_url"),
        ("ip", "10.0.0.256", "scope_invalid_ip"),
        ("ip", "10.0.0.0/8", "scope_invalid_ip"),
        ("cidr", "10.0.0.1", "scope_invalid_cidr"),
        ("cidr", "10.0.0.5/24", "scope_cidr_host_bits"),
        ("cidr", "10.0.0.0/33", "scope_invalid_cidr"),
        ("other", "", "string_too_short"),
    ],
)
def test_invalid_scope_entries_are_rejected_not_rewritten(logged_in, kind, value, code):
    scope = [{"kind": "domain", "value": "ok.example.com"}, {"kind": kind, "value": value}]
    got = errors(logged_in.post("/api/projects", json=body(scope=scope), headers=w(logged_in)))
    assert got == {"scope.1.value": code}
    assert (
        value
        not in logged_in.post("/api/projects", json=body(scope=scope), headers=w(logged_in)).text
        or value == ""
    )


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        ("domain", "пример.рф"),  # IDN
        ("domain", "xn--e1afmkfd.xn--p1ai"),
        ("url", "http://10.0.0.1:8080/"),
        ("url", "https://[2001:db8::1]/api"),
        ("ip", "192.0.2.1"),
        ("cidr", "2001:db8::/32"),
    ],
)
def test_valid_scope_entries_are_accepted(logged_in, kind, value):
    project = create(logged_in, scope=[{"kind": kind, "value": value}])
    assert project["scope"][0]["value"] == value


def test_duplicate_scope_entries(logged_in):
    scope = [
        {"kind": "domain", "value": "a.example.com"},
        {"kind": "ip", "value": "192.0.2.1"},
        {"kind": "domain", "value": "A.Example.com"},  # host names are case-insensitive
        {"kind": "ip", "value": "192.0.2.1"},
    ]
    got = errors(logged_in.post("/api/projects", json=body(scope=scope), headers=w(logged_in)))
    assert got == {"scope.2.value": "scope_duplicate", "scope.3.value": "scope_duplicate"}
    # Same value under a different kind is not a duplicate.
    create(
        logged_in,
        scope=[{"kind": "other", "value": "192.0.2.1"}, {"kind": "ip", "value": "192.0.2.1"}],
    )


def test_scope_limits(logged_in):
    too_many = [{"kind": "other", "value": f"asset {i}"} for i in range(501)]
    assert errors(
        logged_in.post("/api/projects", json=body(scope=too_many), headers=w(logged_in))
    ) == {"scope": "too_long"}
    long_note = [{"kind": "other", "value": "x", "note": "n" * 1001}]
    assert errors(
        logged_in.post("/api/projects", json=body(scope=long_note), headers=w(logged_in))
    ) == {"scope.0.note": "string_too_long"}


# --- list: filters, sorting, pagination ----------------------------------------------


@pytest.fixture
def many(logged_in):
    """Seven projects with known names, types, statuses and dates."""
    rows = [
        ("Alpha", "bounty_program", "active", "2026-01-10", 2),
        ("bravo", "pentest_client", "paused", "2025-06-01", 0),
        ("Charlie 100%", "personal_research", "closed", None, 1),
        ("delta_x", "bounty_program", "closed", "2026-03-05", 0),
        ("Echo", "bounty_program", "active", "2024-12-31", 3),
        ("foxtrot", "pentest_client", "active", "2026-01-10", 0),
        ("Golf", "personal_research", "paused", "2023-02-02", 0),
    ]
    for name, type_, status, start, n in rows:
        scope = [{"kind": "other", "value": f"{name} {i}"} for i in range(n)]
        create(logged_in, name=name, type=type_, status=status, start_date=start, scope=scope)
    return logged_in


def names(client, **params) -> list[str]:
    res = client.get("/api/projects", params=params)
    assert res.status_code == 200, res.text
    return [p["name"] for p in res.json()["items"]]


def test_list_items_are_light(many):
    item = many.get("/api/projects", params={"q": "Echo"}).json()["items"][0]
    assert set(item) == {
        "id",
        "name",
        "type",
        "status",
        "start_date",
        "scope_count",
        "created_at",
        "updated_at",
    }
    assert item["scope_count"] == 3


def test_filters(many):
    assert names(many, type="pentest_client", sort="name", order="asc") == ["bravo", "foxtrot"]
    assert names(many, status="closed", sort="name", order="asc") == ["Charlie 100%", "delta_x"]
    assert names(many, type="bounty_program", status="active", sort="name", order="asc") == [
        "Alpha",
        "Echo",
    ]
    assert names(many, q="ALP") == ["Alpha"]
    # LIKE wildcards in the query are literal characters.
    assert names(many, q="100%") == ["Charlie 100%"]
    assert names(many, q="_x") == ["delta_x"]
    assert names(many, q="%") == ["Charlie 100%"]


def test_sorting(many):
    assert names(many, sort="name", order="asc") == [
        "Alpha",
        "bravo",
        "Charlie 100%",
        "delta_x",
        "Echo",
        "foxtrot",
        "Golf",
    ]
    assert names(many, sort="name", order="desc")[0] == "Golf"
    # Equal start dates keep a stable order; projects without a date come last both ways.
    asc = names(many, sort="start_date", order="asc")
    assert asc[:2] == ["Golf", "Echo"] and asc[-1] == "Charlie 100%"
    assert names(many, sort="start_date", order="desc")[-1] == "Charlie 100%"
    assert names(many, sort="status", order="asc")[:3] == ["Alpha", "Echo", "foxtrot"]
    assert names(many, sort="created_at", order="asc")[0] == "Alpha"


def test_pagination(many):
    first = many.get(
        "/api/projects", params={"sort": "name", "order": "asc", "size": 3, "page": 1}
    ).json()
    third = many.get(
        "/api/projects", params={"sort": "name", "order": "asc", "size": 3, "page": 3}
    ).json()
    beyond = many.get("/api/projects", params={"size": 3, "page": 9}).json()
    assert first["total"] == third["total"] == beyond["total"] == 7
    assert [p["name"] for p in first["items"]] == ["Alpha", "bravo", "Charlie 100%"]
    assert [p["name"] for p in third["items"]] == ["Golf"]
    assert beyond["items"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"size": 0},
        {"size": 101},
        {"page": 0},
        {"sort": "password"},
        {"order": "up"},
        {"type": "x"},
        {"q": "x" * 201},
        {"extra": 1},
    ],
)
def test_bad_list_parameters(logged_in, params):
    assert logged_in.get("/api/projects", params=params).status_code == 422


# --- activity -----------------------------------------------------------------------


def test_activity_events(logged_in):
    pid = create(logged_in)["id"]
    put = lambda **o: logged_in.put(f"/api/projects/{pid}", json=body(**o), headers=w(logged_in))  # noqa: E731

    assert put().status_code == 200  # no change → no event
    assert put(status="paused").status_code == 200
    assert put(status="paused", name="Renamed", scope=SCOPE[:1]).status_code == 200
    assert put(status="closed", description="Done").status_code == 200

    events = [(e["action"], e["details"]) for e in reversed(activity(logged_in, pid))]
    assert events == [
        ("project.created", {"name": "Example Corp"}),
        ("project.status_changed", {"from": "active", "to": "paused"}),
        ("project.updated", {"fields": ["name", "scope"]}),
        ("project.status_changed", {"from": "paused", "to": "closed"}),
        # The form sends every field: name and scope went back to the defaults as well.
        ("project.updated", {"fields": ["name", "description", "scope"]}),
    ]


def test_activity_outlives_a_deleted_project(logged_in):
    pid = create(logged_in)["id"]
    logged_in.delete(f"/api/projects/{pid}", headers=w(logged_in))
    assert [e["action"] for e in activity(logged_in, pid)] == ["project.deleted", "project.created"]


def test_failed_write_records_no_activity(logged_in):
    logged_in.post("/api/projects", json=body(name=""), headers=w(logged_in))
    with SessionLocal() as db:
        assert db.scalars(select(ActivityLog)).all() == []


def test_activity_list_is_paginated_and_scoped(logged_in):
    a = create(logged_in, name="A")["id"]
    create(logged_in, name="B")
    for i in range(3):
        logged_in.put(f"/api/projects/{a}", json=body(name=f"A{i}"), headers=w(logged_in))
    page = logged_in.get("/api/activity", params={"project_id": a, "size": 2}).json()
    assert page["total"] == 4 and len(page["items"]) == 2
    assert all(e["project_id"] == a for e in page["items"])
    assert logged_in.get("/api/activity").json()["total"] == 5
    assert logged_in.get("/api/activity", params={"size": 101}).status_code == 422


def test_details_never_contain_free_text(logged_in):
    pid = create(logged_in, description="secret research notes")["id"]
    logged_in.put(
        f"/api/projects/{pid}", json=body(description="more secret notes"), headers=w(logged_in)
    )
    assert "secret" not in str(activity(logged_in, pid))


def test_start_date_round_trip(logged_in):
    project = create(logged_in, start_date=str(date(2026, 12, 31)))
    assert project["start_date"] == "2026-12-31"
