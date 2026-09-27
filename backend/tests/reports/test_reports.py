"""Stage 4: report CRUD, validation, severity vs CVSS, list queries, project link."""

import pytest
from sqlalchemy import select

from app.core.db import SessionLocal
from app.modules.reports.models import Report
from tests.reports.conftest import history, move, report_body, w


def errors(res) -> dict[str, str]:
    assert res.status_code == 422, res.text
    return {e["field"]: e["code"] for e in res.json()["errors"]}


# --- auth ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/reports"),
        ("POST", "/api/reports"),
        ("GET", "/api/reports/1"),
        ("PUT", "/api/reports/1"),
        ("DELETE", "/api/reports/1"),
        ("POST", "/api/reports/1/status"),
        ("GET", "/api/reports/1/attachments"),
        ("POST", "/api/reports/1/attachments"),
        ("GET", "/api/reports/1/attachments/1/download"),
        ("DELETE", "/api/reports/1/attachments/1"),
    ],
)
def test_every_route_requires_a_session(client, method, path):
    assert client.request(method, path).status_code == 401


def test_writes_require_csrf(logged_in, make_report, project):
    r = make_report()
    assert logged_in.post("/api/reports", json=report_body(project)).json()["code"] == "csrf_failed"
    assert logged_in.put(f"/api/reports/{r['id']}", json=report_body(project)).status_code == 403
    assert (
        logged_in.post(f"/api/reports/{r['id']}/status", json={"to": "submitted"}).status_code
        == 403
    )
    assert logged_in.delete(f"/api/reports/{r['id']}").status_code == 403
    evil = {**w(logged_in), "Origin": "https://evil.example"}
    assert (
        logged_in.delete(f"/api/reports/{r['id']}", headers=evil).json()["code"]
        == "untrusted_origin"
    )
    assert logged_in.get(f"/api/reports/{r['id']}").json()["status"] == "draft"


# --- CRUD -------------------------------------------------------------------------------


def test_create_starts_as_draft_and_round_trips(logged_in, make_report, project):
    r = make_report()
    assert r["status"] == "draft"
    assert r["project_id"] == project and r["project_name"] == "Acme"
    assert r["body_md"] == "## Steps\n\n1. `<script>alert(1)</script>`\n"  # stored as typed
    assert r["cvss_score"] == "8.2" and r["severity"] == "high"
    assert r["next_statuses"] == ["submitted"] and r["correction_to"] is None
    assert all(r[k] is None for k in ("submitted_at", "triaged_at", "closed_at", "paid_at"))
    got = logged_in.get(f"/api/reports/{r['id']}").json()
    assert got == r


def test_status_cannot_be_set_through_create_or_update(logged_in, make_report, project):
    assert errors(
        logged_in.post(
            "/api/reports", json={**report_body(project), "status": "paid"}, headers=w(logged_in)
        )
    ) == {"status": "extra_forbidden"}
    r = make_report()
    res = logged_in.put(
        f"/api/reports/{r['id']}",
        json={**report_body(project), "status": "accepted"},
        headers=w(logged_in),
    )
    assert errors(res) == {"status": "extra_forbidden"}


def test_update_and_move_to_another_project(logged_in, make_report):
    r = make_report()
    other = logged_in.post(
        "/api/projects", json={"name": "Other", "type": "pentest_client"}, headers=w(logged_in)
    ).json()["id"]
    body = report_body(
        other,
        title="Renamed",
        severity="critical",
        cvss_score=None,
        cvss_vector=None,
        type="pentest",
    )
    got = logged_in.put(f"/api/reports/{r['id']}", json=body, headers=w(logged_in)).json()
    assert (
        got["title"],
        got["project_id"],
        got["project_name"],
        got["severity"],
        got["cvss_score"],
        got["type"],
    ) == ("Renamed", other, "Other", "critical", None, "pentest")
    assert history(logged_in, r["id"])[-1]["details"] == {
        "fields": ["project_id", "title", "type", "severity", "cvss_score", "cvss_vector"]
    }


def test_delete_report(logged_in, make_report):
    r = make_report()
    assert logged_in.delete(f"/api/reports/{r['id']}", headers=w(logged_in)).status_code == 204
    assert logged_in.get(f"/api/reports/{r['id']}").json()["code"] == "report_not_found"
    assert [e["action"] for e in history(logged_in, r["id"])] == [
        "report.created",
        "report.deleted",
    ]


def test_missing_and_bad_ids(logged_in, project):
    assert logged_in.get("/api/reports/999999").status_code == 404
    assert (
        logged_in.put(
            "/api/reports/999999", json=report_body(project), headers=w(logged_in)
        ).status_code
        == 404
    )
    assert logged_in.get("/api/reports/0").status_code == 422
    assert logged_in.get("/api/reports/abc").status_code == 422


# --- validation -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"title": "   "}, {"title": "string_too_short"}),
        ({"title": "x" * 301}, {"title": "string_too_long"}),
        ({"type": "hof"}, {"type": "enum"}),
        ({"severity": "urgent"}, {"severity": "enum"}),
        ({"cvss_score": "10.1"}, {"cvss_score": "less_than_equal"}),
        ({"cvss_score": "-1"}, {"cvss_score": "greater_than_equal"}),
        ({"cvss_score": "7.25"}, {"cvss_score": "decimal_max_places"}),
        ({"cvss_vector": "CVSS:3.1/AV:N"}, {"cvss_vector": "cvss_vector_invalid"}),
        (
            {"cvss_vector": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"},
            {"cvss_vector": "cvss_vector_invalid"},
        ),
        ({"body_md": "x" * 200_001}, {"body_md": "string_too_long"}),
        ({"bounty_amount": "100"}, {"bounty_currency": "bounty_incomplete"}),
        ({"bounty_currency": "USD"}, {"bounty_amount": "bounty_incomplete"}),
        (
            {"bounty_amount": "100", "bounty_currency": "usd"},
            {"bounty_currency": "string_pattern_mismatch"},
        ),
        (
            {"bounty_amount": "-5", "bounty_currency": "USD"},
            {"bounty_amount": "greater_than_equal"},
        ),
        (
            {"type": "vdp", "bounty_amount": "100", "bounty_currency": "USD"},
            {"bounty_amount": "bounty_requires_bbp"},
        ),
        ({"project_id": 999999}, {"project_id": "project_not_found"}),
        ({"project_id": 0}, {"project_id": "greater_than"}),
    ],
)
def test_invalid_input(logged_in, project, overrides, expected):
    overrides = dict(overrides)
    body = report_body(overrides.pop("project_id", project), **overrides)
    res = logged_in.post("/api/reports", json=body, headers=w(logged_in))
    assert errors(res) == expected


@pytest.mark.parametrize(
    "vector",
    [
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        "CVSS:3.0/AV:A/AC:H/PR:H/UI:R/S:C/C:L/I:N/A:L/E:P/RL:O",
        "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
    ],
)
def test_valid_vectors(make_report, vector):
    assert make_report(cvss_vector=vector)["cvss_vector"] == vector


def test_manual_severity_is_never_overwritten_by_cvss(make_report):
    # A 9.8 vector with a "low" rating: both are kept exactly as given (D-61).
    r = make_report(
        severity="low", cvss_score="9.8", cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
    )
    assert (r["severity"], r["cvss_score"]) == ("low", "9.8")
    # Neither is required, and a score without a vector (or the reverse) is allowed.
    assert make_report(cvss_score=None, cvss_vector=None)["severity"] == "high"
    assert make_report(cvss_score="5.0", cvss_vector=None)["cvss_vector"] is None


def test_empty_optional_strings_become_null(make_report):
    r = make_report(cvss_vector="", bounty_currency="", bounty_amount=None)
    assert r["cvss_vector"] is None and r["bounty_currency"] is None


def test_bounty_round_trip(make_report):
    r = make_report(bounty_amount="1500.50", bounty_currency="EUR")
    assert (r["bounty_amount"], r["bounty_currency"]) == ("1500.50", "EUR")


# --- list: filters, sorting, pagination ---------------------------------------------------------


@pytest.fixture
def many(logged_in, project, make_report):
    other = logged_in.post(
        "/api/projects", json={"name": "Zeta", "type": "pentest_client"}, headers=w(logged_in)
    ).json()["id"]
    specs = [
        ("SQLi in search", "bbp", "critical", project),
        ("Open redirect", "vdp", "low", project),
        ("IDOR on invoices", "bbp", "high", other),
        ("Info leak 100%", "pentest", "info", other),
        ("CSRF_token missing", "cve", "medium", project),
    ]
    ids = {}
    for title, type_, sev, pid in specs:
        ids[title] = make_report(
            title=title, type=type_, severity=sev, project_id=pid, cvss_score=None, cvss_vector=None
        )["id"]
    move(logged_in, ids["SQLi in search"], "submitted")
    move(logged_in, ids["IDOR on invoices"], "submitted")
    return {"client": logged_in, "ids": ids, "project": project, "other": other}


def titles(client, **params) -> list[str]:
    res = client.get("/api/reports", params=params)
    assert res.status_code == 200, res.text
    return [r["title"] for r in res.json()["items"]]


def test_list_items_have_no_body_or_attachments(many):
    item = many["client"].get("/api/reports").json()["items"][0]
    assert "body_md" not in item and "attachments" not in item
    assert {"id", "title", "project_name", "severity", "status", "cvss_score"} <= set(item)


def test_filters(many):
    c = many["client"]
    assert titles(c, project_id=many["other"], sort="title", order="asc") == [
        "IDOR on invoices",
        "Info leak 100%",
    ]
    assert titles(c, type="bbp", sort="title", order="asc") == [
        "IDOR on invoices",
        "SQLi in search",
    ]
    assert titles(c, severity="low") == ["Open redirect"]
    assert titles(c, status="submitted", sort="title", order="asc") == [
        "IDOR on invoices",
        "SQLi in search",
    ]
    assert titles(c, q="100%") == ["Info leak 100%"]
    assert titles(c, q="_token") == ["CSRF_token missing"]


def test_created_date_range(many):
    """Whole UTC days, both ends included (Stage 8: the list filters by date too)."""
    from datetime import UTC, datetime

    from sqlalchemy import update

    from app.core.db import SessionLocal
    from app.modules.reports.models import Report

    c, ids = many["client"], many["ids"]
    placed = {
        "SQLi in search": datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC),
        "IDOR on invoices": datetime(2026, 2, 1, 0, 0, tzinfo=UTC),
        "Open redirect": datetime(2026, 2, 28, 23, 59, tzinfo=UTC),
        "Info leak 100%": datetime(2026, 3, 1, 0, 0, tzinfo=UTC),
        "CSRF_token missing": datetime(2025, 12, 1, tzinfo=UTC),
    }
    with SessionLocal() as db:
        for title, at in placed.items():
            db.execute(update(Report).where(Report.id == ids[title]).values(created_at=at))
        db.commit()
    feb = {"created_from": "2026-02-01", "created_to": "2026-02-28", "sort": "title"}
    assert titles(c, **feb, order="asc") == ["IDOR on invoices", "Open redirect"]
    assert titles(c, created_from="2026-03-01") == ["Info leak 100%"]
    assert titles(c, created_to="2025-12-31") == ["CSRF_token missing"]
    assert titles(c, created_from="2026-01-31", created_to="2026-01-31") == ["SQLi in search"]
    res = c.get("/api/reports", params={"created_from": "2026-03-01", "created_to": "2026-02-01"})
    assert res.status_code == 422
    assert res.json()["errors"][0]["code"] == "date_range_reversed"
    assert c.get("/api/reports", params={"created_from": "2026-13-01"}).status_code == 422


def test_sorting(many):
    c = many["client"]
    assert titles(c, sort="severity", order="desc") == [
        "SQLi in search",
        "IDOR on invoices",
        "CSRF_token missing",
        "Open redirect",
        "Info leak 100%",
    ]
    assert titles(c, sort="severity", order="asc")[0] == "Info leak 100%"
    by_status = titles(c, sort="status", order="desc")
    assert set(by_status[:2]) == {"SQLi in search", "IDOR on invoices"}
    submitted = titles(c, sort="submitted_at", order="desc")
    assert set(submitted[:2]) == {"SQLi in search", "IDOR on invoices"}  # NULLs last
    assert titles(c, sort="title", order="asc")[0] == "CSRF_token missing"


def test_pagination(many):
    c = many["client"]
    first = c.get("/api/reports", params={"size": 2, "sort": "title", "order": "asc"}).json()
    last = c.get(
        "/api/reports", params={"size": 2, "page": 3, "sort": "title", "order": "asc"}
    ).json()
    assert first["total"] == last["total"] == 5
    assert len(first["items"]) == 2 and len(last["items"]) == 1


@pytest.mark.parametrize(
    "params",
    [{"size": 101}, {"sort": "body_md"}, {"severity": "x"}, {"project_id": 0}, {"extra": 1}],
)
def test_bad_list_parameters(logged_in, params):
    assert logged_in.get("/api/reports", params=params).status_code == 422


# --- project link --------------------------------------------------------------------------------


def test_project_with_reports_cannot_be_deleted(logged_in, project, make_report):
    r = make_report()
    res = logged_in.delete(f"/api/projects/{project}", headers=w(logged_in))
    assert res.status_code == 409
    assert res.json()["code"] == "project_has_reports"
    assert logged_in.get(f"/api/projects/{project}").status_code == 200
    assert logged_in.get(f"/api/reports/{r['id']}").status_code == 200
    # No "project.deleted" event was left behind by the refused delete.
    acts = logged_in.get(
        "/api/activity", params={"entity_type": "project", "entity_id": project}
    ).json()["items"]
    assert [a["action"] for a in acts] == ["project.created"]
    # Once the report is gone, the project can be deleted.
    logged_in.delete(f"/api/reports/{r['id']}", headers=w(logged_in))
    assert logged_in.delete(f"/api/projects/{project}", headers=w(logged_in)).status_code == 204


def test_database_restricts_project_deletion_too(logged_in, project, make_report):
    make_report()
    from sqlalchemy import delete
    from sqlalchemy.exc import IntegrityError

    from app.modules.projects.models import Project

    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.execute(delete(Project).where(Project.id == project))
        db.commit()
    with SessionLocal() as db:
        assert db.scalar(select(Report.project_id)) == project


def test_project_activity_includes_report_events(logged_in, project, make_report):
    r = make_report()
    move(logged_in, r["id"], "submitted")
    acts = logged_in.get("/api/activity", params={"project_id": project}).json()["items"]
    assert [a["action"] for a in acts][:2] == ["report.status_changed", "report.created"]
    assert all(a["actor"] == "researcher" for a in acts)
