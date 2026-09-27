import pytest
from fastapi.testclient import TestClient

from tests.conftest import ORIGIN


def w(client: TestClient) -> dict[str, str]:
    """Headers for a state-changing request: CSRF token + trusted Origin."""
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


def report_body(project_id: int, **overrides) -> dict:
    return {
        "project_id": project_id,
        "title": "Stored XSS in profile name",
        "type": "bbp",
        "severity": "high",
        "cvss_score": "8.2",
        "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:L/A:N",
        "body_md": "## Steps\n\n1. `<script>alert(1)</script>`\n",
        "bounty_amount": None,
        "bounty_currency": None,
        **overrides,
    }


@pytest.fixture
def project(logged_in) -> int:
    res = logged_in.post(
        "/api/projects", json={"name": "Acme", "type": "bounty_program"}, headers=w(logged_in)
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.fixture
def make_report(logged_in, project):
    def make(**overrides) -> dict:
        body = report_body(overrides.pop("project_id", project), **overrides)
        res = logged_in.post("/api/reports", json=body, headers=w(logged_in))
        assert res.status_code == 201, res.text
        return res.json()

    return make


def move(client: TestClient, report_id: int, to: str, **extra):
    return client.post(
        f"/api/reports/{report_id}/status", json={"to": to, **extra}, headers=w(client)
    )


def history(client: TestClient, report_id: int) -> list[dict]:
    res = client.get(
        "/api/activity", params={"entity_type": "report", "entity_id": report_id, "size": 100}
    )
    assert res.status_code == 200, res.text
    return list(reversed(res.json()["items"]))  # oldest first
