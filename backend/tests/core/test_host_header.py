"""Host-header allowlist: the backend's DNS-rebinding defence (D-51)."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app, request_hostname

SETUP = {"username": "owner", "password": "x" * 16, "password_confirm": "x" * 16}


def client_for(host: str) -> TestClient:
    return TestClient(create_app(), base_url=f"http://{host}", client=("127.0.0.1", 50000))


@pytest.mark.parametrize("host", ["127.0.0.1:8000", "localhost:5173", "[::1]:8000", "LOCALHOST"])
def test_loopback_host_names_are_accepted(host):
    with client_for(host) as c:
        assert c.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    "host", ["evil.example:8000", "evil.example", "192.168.1.17:5173", "127.0.0.1.evil.example"]
)
def test_foreign_host_is_rejected_everywhere(host):
    with client_for(host) as c:
        for method, path, body in [
            ("GET", "/api/health", None),
            ("POST", "/api/auth/login", {"username": "nobody", "password": "x"}),
            ("GET", "/api/auth/setup", None),
        ]:
            res = c.request(method, path, json=body)
            assert res.status_code == 400, (method, path)
            assert res.json()["code"] == "invalid_host"
            assert res.headers["x-content-type-options"] == "nosniff"


def test_dns_rebinding_cannot_claim_an_empty_instance():
    """A local browser on evil.example (rebound to 127.0.0.1) sends matching Host and Origin."""
    with client_for("evil.example:8000") as c:
        res = c.post("/api/auth/setup", json=SETUP, headers={"Origin": "http://evil.example:8000"})
    assert res.status_code == 400
    assert res.json()["code"] == "invalid_host"
    with client_for("127.0.0.1:8000") as c:
        assert c.get("/api/auth/setup").json() == {"required": True}


def test_allowed_hosts_are_configurable(monkeypatch):
    monkeypatch.setenv("HEXOPS_ALLOWED_HOSTS", "127.0.0.1, HexOps.LAN")
    assert Settings().allowed_hosts == ["127.0.0.1", "hexops.lan"]


def test_non_loopback_bind_address_is_allowed_automatically(monkeypatch):
    monkeypatch.setenv("HEXOPS_HOST", "192.168.1.17")
    monkeypatch.setenv("HEXOPS_ALLOW_LAN", "true")
    assert "192.168.1.17" in Settings().allowed_hosts
    monkeypatch.setenv("HEXOPS_HOST", "0.0.0.0")  # noqa: S104 - checking the wildcard is not a hostname
    assert "0.0.0.0" not in Settings().allowed_hosts  # noqa: S104


@pytest.mark.parametrize(
    ("header", "name"),
    [
        ("127.0.0.1:8000", "127.0.0.1"),
        ("[::1]:8000", "::1"),
        ("::1", "::1"),
        ("Example.COM", "example.com"),
        ("", ""),
    ],
)
def test_request_hostname(header, name):
    assert request_hostname(header) == name
