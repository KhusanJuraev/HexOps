import hashlib
import io
import json
import time
import zipfile
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.modules.transfer import container
from app.modules.transfer.jobs import worker
from app.modules.transfer.tables import DATA_TABLES
from tests.conftest import ORIGIN

PASSPHRASE = "correct horse battery staple export"
PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 40


def w(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


@pytest.fixture(autouse=True)
def wait_for_worker() -> Iterator[None]:
    yield
    deadline = time.monotonic() + 120
    while not worker.idle() and time.monotonic() < deadline:
        time.sleep(0.05)


def wait_job(client: TestClient, job_id: int, timeout: float = 120) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/api/transfer/jobs/{job_id}", params={"wait": 10})
        assert res.status_code == 200, res.text
        job = res.json()
        if job["status"] in ("validated", "done", "failed"):
            return job
    raise AssertionError(f"transfer job {job_id} did not finish")


def export(client: TestClient, passphrase: str = PASSPHRASE) -> tuple[dict, bytes]:
    res = client.post("/api/transfer/exports", json={"passphrase": passphrase}, headers=w(client))
    assert res.status_code == 202, res.text
    job = wait_job(client, res.json()["id"])
    assert job["status"] == "done", job
    data = client.get(f"/api/transfer/jobs/{job['id']}/download")
    assert data.status_code == 200
    return job, data.content


def upload(client: TestClient, archive: bytes, passphrase: str = PASSPHRASE):
    return client.post(
        "/api/transfer/imports",
        files={"file": ("backup.hexops", archive, "application/octet-stream")},
        data={"passphrase": passphrase},
        headers=w(client),
    )


def check(client: TestClient, archive: bytes, passphrase: str = PASSPHRASE) -> dict:
    res = upload(client, archive, passphrase)
    assert res.status_code == 202, res.text
    return wait_job(client, res.json()["id"])


def apply(client: TestClient, job_id: int, replace: bool = False, passphrase: str = PASSPHRASE):
    return client.post(
        f"/api/transfer/jobs/{job_id}/apply",
        json={"passphrase": passphrase, "replace": replace},
        headers=w(client),
    )


def fill(client: TestClient, tag: str = "a") -> None:
    """A workspace with every kind of record: scope, statuses, bounty, evidence, tags."""
    h = w(client)
    p1 = client.post(
        "/api/projects",
        json={
            "name": f"Acme {tag}",
            "type": "bounty_program",
            "start_date": "2026-01-31",
            "scope": [
                {"kind": "wildcard", "value": "*.acme.example", "note": "main"},
                {"kind": "cidr", "value": "10.0.0.0/24", "note": ""},
            ],
        },
        headers=h,
    ).json()["id"]
    p2 = client.post(
        "/api/projects", json={"name": f"Zeta {tag}", "type": "pentest_client"}, headers=h
    ).json()["id"]
    r1 = client.post(
        "/api/reports",
        json={
            "project_id": p1,
            "title": f"SQLi «тест» oʻzbek {tag}",
            "type": "bbp",
            "severity": "critical",
            "cvss_score": "9.8",
            "bounty_amount": "1234.56",
            "bounty_currency": "USD",
            "body_md": "# Steps\n\n```\ncurl -X POST\n```\n",
        },
        headers=h,
    ).json()["id"]
    for to in ("submitted", "triaged", "accepted", "paid"):
        assert (
            client.post(f"/api/reports/{r1}/status", json={"to": to}, headers=h).status_code == 200
        )
    r2 = client.post(
        "/api/reports",
        json={"project_id": p2, "title": f"Info leak {tag}", "type": "pentest", "severity": "low"},
        headers=h,
    ).json()["id"]
    for name, data in (("shot.png", PNG), ("poc.txt", f"payload {tag} ✓".encode())):
        res = client.post(f"/api/reports/{r1}/attachments", files={"file": (name, data)}, headers=h)
        assert res.status_code == 201, res.text
    client.post(
        f"/api/reports/{r2}/attachments", files={"file": ("log.txt", b"GET /x\n")}, headers=h
    )
    client.post(
        "/api/notes",
        json={
            "title": f"Recon {tag}",
            "project_id": p1,
            "tags": ["recon", "todo"],
            "body_md": "api, admin",
        },
        headers=h,
    )
    client.post(
        "/api/notes",
        json={"title": f"Loose {tag}", "tags": ["cheat-sheet"], "body_md": "no project"},
        headers=h,
    )


def snapshot(client: TestClient) -> dict:
    """Everything the owner can see, with evidence bytes hashed — compared before/after."""
    state: dict = {"projects": [], "reports": [], "notes": []}
    for p in client.get("/api/projects?size=100").json()["items"]:
        state["projects"].append(client.get(f"/api/projects/{p['id']}").json())
    for r in client.get("/api/reports?size=100").json()["items"]:
        detail = client.get(f"/api/reports/{r['id']}").json()
        atts = client.get(f"/api/reports/{r['id']}/attachments").json()
        for a in atts:
            body = client.get(f"/api/reports/{r['id']}/attachments/{a['id']}/download").content
            a["bytes_sha256"] = hashlib.sha256(body).hexdigest()
        detail["attachments"] = atts
        state["reports"].append(detail)
    for n in client.get("/api/notes?size=100").json()["items"]:
        state["notes"].append(client.get(f"/api/notes/{n['id']}").json())
    state["activity"] = [
        {k: e[k] for k in ("entity_type", "entity_id", "action", "details", "occurred_at")}
        for e in client.get("/api/activity?size=100").json()["items"]
    ]
    state["bounties"] = client.get("/api/dashboard/bounties").json()
    return state


def wipe_data() -> None:
    """A fresh installation's data: no records, no evidence (the account stays)."""
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(DATA_TABLES)} RESTART IDENTITY CASCADE"))
    for f in get_settings().uploads_dir.glob("*"):
        f.unlink()


def unpack(archive: bytes, passphrase: str = PASSPHRASE) -> bytes:
    return b"".join(container.open_container(io.BytesIO(archive), passphrase))


def seal(plain_zip: bytes, passphrase: str = PASSPHRASE) -> bytes:
    out = io.BytesIO()
    writer = container.EncryptingWriter(out, passphrase)
    writer.write(plain_zip)
    writer.close()
    return out.getvalue()


def rebuild(
    archive: bytes,
    change: Callable[[dict[str, bytes], dict], None],
    extra: Callable[[zipfile.ZipFile], None] | None = None,
) -> bytes:
    """Decrypt a real export, let `change` edit entries/manifest, re-encrypt it."""
    with zipfile.ZipFile(io.BytesIO(unpack(archive))) as zf:
        entries = {i.filename: zf.read(i) for i in zf.infolist()}
    manifest = json.loads(entries.pop("manifest.json"))
    change(entries, manifest)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
        zf.writestr("manifest.json", json.dumps(manifest))
        if extra:
            extra(zf)
    return seal(out.getvalue())


def restamp(entries: dict[str, bytes], manifest: dict, table: str) -> None:
    """Make the manifest agree with an edited data file (to reach the deeper checks)."""
    data = entries[f"data/{table}.json"]
    meta = manifest["tables"][table]
    meta["size"], meta["sha256"] = len(data), hashlib.sha256(data).hexdigest()
    meta["rows"] = len(json.loads(data)["rows"])
