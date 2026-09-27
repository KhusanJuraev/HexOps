"""Status workflow: every transition, corrections, dates, Paid rules, activity."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.core.db import SessionLocal
from app.modules.reports.models import Report
from tests.reports.conftest import history, move, report_body, w

ALL = ["draft", "submitted", "triaged", "accepted", "duplicate", "rejected", "paid"]
PATH = {
    "draft": [],
    "submitted": ["submitted"],
    "triaged": ["submitted", "triaged"],
    "accepted": ["submitted", "triaged", "accepted"],
    "duplicate": ["submitted", "triaged", "duplicate"],
    "rejected": ["submitted", "triaged", "rejected"],
    "paid": ["submitted", "triaged", "accepted", "paid"],
}
FORWARD = {
    "draft": {"submitted"},
    "submitted": {"triaged"},
    "triaged": {"accepted", "duplicate", "rejected"},
    "accepted": {"paid"},
    "duplicate": set(),
    "rejected": set(),
    "paid": set(),
}
BACK = {
    "submitted": "draft",
    "triaged": "submitted",
    "accepted": "triaged",
    "duplicate": "triaged",
    "rejected": "triaged",
    "paid": "accepted",
}
DATE = {
    "submitted": "submitted_at",
    "triaged": "triaged_at",
    "accepted": "closed_at",
    "duplicate": "closed_at",
    "rejected": "closed_at",
    "paid": "paid_at",
}


def reach(client, make_report, state: str, type_: str = "bbp") -> dict:
    r = make_report(type=type_)
    for step in PATH[state]:
        res = move(client, r["id"], step)
        assert res.status_code == 200, (state, step, res.text)
        r = res.json()
    return r


@pytest.mark.parametrize("type_", ["bbp", "vdp"])
@pytest.mark.parametrize("current", [s for s in ALL if not (s == "paid")])
def test_every_forward_transition(logged_in, make_report, current, type_):
    for target in ALL:
        r = reach(logged_in, make_report, current, type_)
        res = move(logged_in, r["id"], target)
        legal = target in FORWARD[current] and not (target == "paid" and type_ != "bbp")
        if legal:
            assert res.status_code == 200, (current, target, res.text)
            assert res.json()["status"] == target
        else:
            assert res.status_code == 409, (current, target, type_)
            expected = (
                "paid_requires_bbp"
                if (target == "paid" and current == "accepted")
                else "invalid_status_transition"
            )
            assert res.json()["code"] == expected
            assert logged_in.get(f"/api/reports/{r['id']}").json()["status"] == current  # unchanged


def test_paid_reports_allow_nothing_forward(logged_in, make_report):
    r = reach(logged_in, make_report, "paid")
    for target in ALL:
        assert move(logged_in, r["id"], target).status_code == 409


@pytest.mark.parametrize("current", [s for s in ALL if s != "draft"])
def test_every_correction(logged_in, make_report, current):
    for target in ALL:
        r = reach(logged_in, make_report, current)
        res = move(logged_in, r["id"], target, correction=True)
        if target == BACK[current]:
            assert res.status_code == 200, res.text
            got = res.json()
            assert got["status"] == target
            assert got[DATE[current]] is None  # the undone step's date is cleared
            if target in DATE:
                assert got[DATE[target]] is not None  # the earlier date is kept
        else:
            assert res.status_code == 409 and res.json()["code"] == "invalid_status_correction"


def test_draft_has_nothing_to_correct(logged_in, make_report):
    r = make_report()
    assert (
        move(logged_in, r["id"], "draft", correction=True).json()["code"]
        == "invalid_status_correction"
    )


def test_backwards_without_the_correction_flag_is_refused(logged_in, make_report):
    r = reach(logged_in, make_report, "triaged")
    assert move(logged_in, r["id"], "submitted").json()["code"] == "invalid_status_transition"
    assert (
        move(logged_in, r["id"], "accepted", correction=True).json()["code"]
        == "invalid_status_correction"
    )


def test_dates_are_set_in_order_and_exposed(logged_in, make_report):
    r = reach(logged_in, make_report, "paid")
    dates = [r["submitted_at"], r["triaged_at"], r["closed_at"], r["paid_at"]]
    assert all(dates) and dates == sorted(dates)
    assert r["next_statuses"] == [] and r["correction_to"] == "accepted"
    t = reach(logged_in, make_report, "triaged")
    assert (
        t["next_statuses"] == ["accepted", "duplicate", "rejected"]
        and t["correction_to"] == "submitted"
    )
    a = reach(logged_in, make_report, "accepted", "vdp")
    assert a["next_statuses"] == []  # Paid is never offered for non-BBP


def test_custom_step_dates(logged_in, make_report):
    r = make_report()
    yesterday = datetime.now(UTC) - timedelta(days=1)
    res = move(logged_in, r["id"], "submitted", at=yesterday.isoformat())
    assert res.status_code == 200
    assert datetime.fromisoformat(res.json()["submitted_at"]) == yesterday.replace(
        microsecond=yesterday.microsecond
    )

    too_early = (yesterday - timedelta(hours=1)).isoformat()
    assert _field(move(logged_in, r["id"], "triaged", at=too_early)) == (
        "at",
        "status_date_before_previous",
    )
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    assert _field(move(logged_in, r["id"], "triaged", at=future)) == ("at", "status_date_in_future")
    assert _field(move(logged_in, r["id"], "triaged", at="2026-01-01T10:00:00")) == (
        "at",
        "timezone_required",
    )
    assert logged_in.get(f"/api/reports/{r['id']}").json()["status"] == "submitted"
    assert history(logged_in, r["id"])[-1]["details"]["at"] == yesterday.isoformat()


def _field(res) -> tuple[str, str]:
    assert res.status_code == 422, res.text
    e = res.json()["errors"][0]
    return e["field"], e["code"]


def test_paid_requires_bbp_on_edit_and_in_the_database(logged_in, make_report, project):
    r = reach(logged_in, make_report, "paid")
    res = logged_in.put(
        f"/api/reports/{r['id']}", json=report_body(project, type="vdp"), headers=w(logged_in)
    )
    assert _field(res) == ("type", "paid_requires_bbp")
    assert logged_in.get(f"/api/reports/{r['id']}").json()["type"] == "bbp"
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.execute(update(Report).where(Report.id == r["id"]).values(type="vdp"))
        db.commit()


def test_paid_bounty_is_optional(logged_in, make_report):
    r = reach(logged_in, make_report, "paid")
    assert r["bounty_amount"] is None and r["status"] == "paid"


def test_every_transition_and_correction_is_in_history_with_actor_and_time(logged_in, make_report):
    r = reach(logged_in, make_report, "accepted")
    move(logged_in, r["id"], "triaged", correction=True)
    move(logged_in, r["id"], "rejected")
    events = history(logged_in, r["id"])
    assert [(e["action"], e["details"].get("from"), e["details"].get("to")) for e in events] == [
        ("report.created", None, None),
        ("report.status_changed", "draft", "submitted"),
        ("report.status_changed", "submitted", "triaged"),
        ("report.status_changed", "triaged", "accepted"),
        ("report.status_corrected", "accepted", "triaged"),
        ("report.status_changed", "triaged", "rejected"),
    ]
    assert all(e["actor"] == "researcher" and e["occurred_at"] for e in events)


def test_refused_transitions_leave_no_trace(logged_in, make_report):
    r = make_report()
    move(logged_in, r["id"], "paid")
    move(logged_in, r["id"], "draft", correction=True)
    assert [e["action"] for e in history(logged_in, r["id"])] == ["report.created"]


def test_status_body_is_validated(logged_in, make_report):
    r = make_report()
    assert move(logged_in, r["id"], "archived").status_code == 422
    assert (
        logged_in.post(
            f"/api/reports/{r['id']}/status",
            json={"to": "submitted", "extra": 1},
            headers=w(logged_in),
        ).status_code
        == 422
    )
    assert move(logged_in, 999999, "submitted").status_code == 404
