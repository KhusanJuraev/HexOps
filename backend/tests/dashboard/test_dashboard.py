"""Stage 6 dashboard: every number from current rows; currencies never mixed (D-77)."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import update

from app.core.db import SessionLocal
from app.modules.reports.models import Report
from tests.conftest import ORIGIN

ENDPOINTS = ["summary", "severity", "status", "timeline", "bounties"]


def w(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


def get(client, name: str, **params) -> dict:
    res = client.get(f"/api/dashboard/{name}", params=params)
    assert res.status_code == 200, res.text
    return res.json()


def this_month() -> str:
    now = datetime.now(UTC)
    return f"{now.year:04d}-{now.month:02d}"


@pytest.mark.parametrize("name", ENDPOINTS)
def test_requires_a_session(client, name):
    assert client.get(f"/api/dashboard/{name}").status_code == 401


def test_empty_database_shows_zeros_not_invented_data(logged_in):
    assert get(logged_in, "summary") == {
        "projects": {"active": 0, "paused": 0, "closed": 0},
        "active_projects": 0,
        "reports": 0,
        "notes": 0,
    }
    sev = get(logged_in, "severity")
    assert sev["total"] == 0 and set(sev["counts"].values()) == {0}
    assert list(sev["counts"]) == ["critical", "high", "medium", "low", "info"]
    st = get(logged_in, "status")
    assert st["total"] == 0 and list(st["counts"]) == [
        "draft",
        "submitted",
        "triaged",
        "accepted",
        "duplicate",
        "rejected",
        "paid",
    ]
    tl = get(logged_in, "timeline")
    assert (
        len(tl["months"]) == 12 and tl["months"][-1]["month"] == this_month() and tl["total"] == 0
    )
    assert get(logged_in, "bounties") == {"currencies": [], "unpriced_paid": 0, "unpaid": []}


@pytest.fixture
def fixture(logged_in):
    """Projects in every status and reports across statuses, months and currencies."""
    c = logged_in
    projects = {}
    for name, status in (("A", "active"), ("B", "active"), ("C", "paused"), ("D", "closed")):
        projects[name] = c.post(
            "/api/projects",
            json={"name": name, "type": "bounty_program", "status": status},
            headers=w(c),
        ).json()["id"]

    def report(severity, type_="bbp", steps=(), bounty=None, created=None, paid=None):
        body = {
            "project_id": projects["A"],
            "title": f"{severity} {type_}",
            "type": type_,
            "severity": severity,
        }
        if bounty:
            body |= {"bounty_amount": bounty[0], "bounty_currency": bounty[1]}
        rid = c.post("/api/reports", json=body, headers=w(c)).json()["id"]
        for step in steps:
            assert (
                c.post(f"/api/reports/{rid}/status", json={"to": step}, headers=w(c)).status_code
                == 200
            )
        with SessionLocal() as db:  # place the fixture in time (disposable test data)
            values = {}
            if created:
                values["created_at"] = created
            if paid:
                values["paid_at"] = paid
            if values:
                db.execute(update(Report).where(Report.id == rid).values(**values))
                db.commit()
        return rid

    to_paid = ("submitted", "triaged", "accepted", "paid")
    report("critical", created=datetime(2026, 1, 15, tzinfo=UTC))
    report("critical", steps=("submitted",), created=datetime(2026, 1, 31, 23, 30, tzinfo=UTC))
    report("high", steps=("submitted", "triaged"), created=datetime(2026, 3, 1, 0, 30, tzinfo=UTC))
    report(
        "low",
        type_="vdp",
        steps=("submitted", "triaged", "rejected"),
        created=datetime(2025, 12, 31, 23, 59, tzinfo=UTC),
    )
    report(
        "medium",
        steps=to_paid,
        bounty=("100.50", "USD"),
        created=datetime(2026, 2, 1, tzinfo=UTC),
        paid=datetime(2026, 2, 10, tzinfo=UTC),
    )
    report(
        "high",
        steps=to_paid,
        bounty=("200.25", "USD"),
        created=datetime(2026, 2, 5, tzinfo=UTC),
        paid=datetime(2026, 4, 1, tzinfo=UTC),
    )
    report(
        "high",
        steps=to_paid,
        bounty=("50.00", "EUR"),
        created=datetime(2026, 2, 6, tzinfo=UTC),
        paid=datetime(2026, 2, 20, tzinfo=UTC),
    )
    report(
        "info",
        steps=to_paid,
        created=datetime(2026, 2, 7, tzinfo=UTC),
        paid=datetime(2026, 3, 3, tzinfo=UTC),
    )  # paid, no amount
    report(
        "low",
        steps=to_paid,
        bounty=("9999.99", "USD"),
        created=datetime(2024, 6, 1, tzinfo=UTC),
        paid=datetime(2024, 6, 2, tzinfo=UTC),
    )  # out of range
    c.post("/api/notes", json={"title": "n"}, headers=w(c))
    return c


def test_counts(fixture):
    s = get(fixture, "summary")
    assert s["projects"] == {"active": 2, "paused": 1, "closed": 1} and s["active_projects"] == 2
    assert (s["reports"], s["notes"]) == (9, 1)
    sev = get(fixture, "severity")
    assert (
        sev["counts"] == {"critical": 2, "high": 3, "medium": 1, "low": 2, "info": 1}
        and sev["total"] == 9
    )
    st = get(fixture, "status")
    assert st["counts"] == {
        "draft": 1,
        "submitted": 1,
        "triaged": 1,
        "accepted": 0,
        "duplicate": 0,
        "rejected": 1,
        "paid": 5,
    }


def test_findings_over_time_uses_utc_months_and_the_range(fixture):
    tl = get(fixture, "timeline", start="2025-12", end="2026-04")
    assert tl["months"] == [
        {"month": "2025-12", "count": 1},
        {"month": "2026-01", "count": 2},  # 31 Jan 23:30 UTC stays in January
        {"month": "2026-02", "count": 4},
        {"month": "2026-03", "count": 1},
        {"month": "2026-04", "count": 0},  # zero-filled, not skipped
    ]
    assert tl["total"] == 8  # the 2024 report is outside the range
    assert get(fixture, "timeline", start="2024-06", end="2024-06")["months"] == [
        {"month": "2024-06", "count": 1}
    ]


def test_bounties_are_per_currency_and_never_added_together(fixture):
    b = get(fixture, "bounties", start="2026-01", end="2026-04")
    assert [c["currency"] for c in b["currencies"]] == ["EUR", "USD"]
    eur, usd = b["currencies"]
    assert (eur["total"], eur["count"]) == ("50.00", 1)
    assert (usd["total"], usd["count"]) == ("300.75", 2)  # exact decimals, not floats
    assert [(m["month"], m["amount"]) for m in usd["months"]] == [
        ("2026-01", "0.00"),
        ("2026-02", "100.50"),
        ("2026-03", "0.00"),
        ("2026-04", "200.25"),
    ]
    assert [(m["month"], m["amount"]) for m in eur["months"]][1] == ("2026-02", "50.00")
    assert b["unpriced_paid"] == 1  # paid in March without an amount: counted, not guessed
    older = get(fixture, "bounties", start="2024-01", end="2024-12")
    assert older["currencies"][0]["total"] == "9999.99" and older["unpriced_paid"] == 0


def test_numbers_follow_the_data_immediately(fixture):
    before = get(fixture, "severity")["counts"]["critical"]
    pid = fixture.post(
        "/api/projects", json={"name": "E", "type": "pentest_client"}, headers=w(fixture)
    ).json()["id"]
    fixture.post(
        "/api/reports",
        json={"project_id": pid, "title": "x", "type": "pentest", "severity": "critical"},
        headers=w(fixture),
    )
    assert get(fixture, "severity")["counts"]["critical"] == before + 1
    assert get(fixture, "summary")["active_projects"] == 3


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-05", "end": "2026-01"},
        {"start": "2020-01", "end": "2026-01"},
        {"start": "2026-13"},
        {"start": "26-01"},
        {"end": "2026-1"},
        {"extra": "x"},
    ],
)
def test_bad_ranges(logged_in, params):
    assert logged_in.get("/api/dashboard/timeline", params=params).status_code == 422
    assert logged_in.get("/api/dashboard/bounties", params=params).status_code == 422


def test_default_range_is_the_last_twelve_months(logged_in):
    months = [m["month"] for m in get(logged_in, "timeline")["months"]]
    assert [c["currency"] for c in get(logged_in, "bounties")["currencies"]] == []
    today = date.today()
    assert len(months) == 12 and months[-1] == f"{today.year:04d}-{today.month:02d}"


def test_bounty_amounts_on_unpaid_reports_are_shown_apart_never_as_earnings(logged_in):
    """The reported case: an amount typed on a draft or submitted BBP report is visible,
    per currency, but is not earnings until the report is marked Paid."""
    c = logged_in
    pid = c.post(
        "/api/projects", json={"name": "P", "type": "bounty_program"}, headers=w(c)
    ).json()["id"]

    def bbp(amount, currency, steps=(), type_="bbp"):
        body = {"project_id": pid, "title": f"{amount}", "type": type_, "severity": "high"}
        if amount:
            body |= {"bounty_amount": amount, "bounty_currency": currency}
        rid = c.post("/api/reports", json=body, headers=w(c)).json()["id"]
        for to in steps:
            res = c.post(f"/api/reports/{rid}/status", json={"to": to}, headers=w(c))
            assert res.status_code == 200, res.text
        return rid

    bbp("100000.00", "UZS")  # draft
    bbp("100.00", "USD", ("submitted",))
    bbp("50.00", "USD", ("submitted", "triaged", "accepted"))
    bbp("999.00", "USD", ("submitted", "triaged", "rejected"))  # will not be paid
    bbp("777.00", "USD", ("submitted", "triaged", "duplicate"))
    bbp(None, None, ("submitted",))  # no amount at all
    b = get(c, "bounties")
    assert b["currencies"] == [] and b["unpriced_paid"] == 0  # no earnings invented
    # Per currency, sorted, never added across currencies; rejected/duplicate excluded.
    assert b["unpaid"] == [
        {"currency": "USD", "total": "150.00", "count": 2},
        {"currency": "UZS", "total": "100000.00", "count": 1},
    ]


def test_paying_moves_an_amount_into_earnings_and_a_correction_moves_it_back(logged_in):
    c = logged_in
    pid = c.post(
        "/api/projects", json={"name": "P", "type": "bounty_program"}, headers=w(c)
    ).json()["id"]
    rid = c.post(
        "/api/reports",
        json={
            "project_id": pid,
            "title": "IDOR",
            "type": "bbp",
            "severity": "high",
            "bounty_amount": "1234.56",
            "bounty_currency": "EUR",
        },
        headers=w(c),
    ).json()["id"]
    for to in ("submitted", "triaged", "accepted", "paid"):
        res = c.post(f"/api/reports/{rid}/status", json={"to": to}, headers=w(c))
        assert res.status_code == 200
    b = get(c, "bounties")
    assert [(x["currency"], x["total"], x["count"]) for x in b["currencies"]] == [
        ("EUR", "1234.56", 1)
    ]
    last = b["currencies"][0]["months"][-1]
    assert last == {"month": this_month(), "amount": "1234.56", "count": 1}
    assert b["unpaid"] == []
    # Outside the chosen months, the paid amount is not in the range; it is still paid.
    old = get(c, "bounties", start="2024-01", end="2024-12")
    assert old["currencies"] == [] and old["unpaid"] == []

    # Undo Paid (status correction): it leaves earnings and shows as not paid again.
    res = c.post(
        f"/api/reports/{rid}/status", json={"to": "accepted", "correction": True}, headers=w(c)
    )
    assert res.status_code == 200, res.text
    b = get(c, "bounties")
    assert b["currencies"] == []
    assert b["unpaid"] == [{"currency": "EUR", "total": "1234.56", "count": 1}]
