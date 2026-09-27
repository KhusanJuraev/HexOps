import time
from collections.abc import Iterator
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.modules.pdf.jobs import worker
from tests.conftest import ORIGIN

FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")

# One body with everything an export must print: three languages, code, a table.
TRILINGUAL_MD = """# Kirish

Oʻzbekcha: gʻalaba va oʻquvchi maʼlumotlari.

## Введение

Русский текст: съешь же ещё этих мягких французских булок.

## Overview

English text about the injection point.

```python
def payload():
    return "' OR 1=1 --"
```

| Host | Port |
|---|---|
| 10.0.0.5 | 443 |
| api.example.com | 8443 |
"""


def w(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


@pytest.fixture(autouse=True)
def wait_for_worker() -> Iterator[None]:
    """Never let a job still running in the worker overlap the next test's cleanup."""
    yield
    deadline = time.monotonic() + 60
    while not worker.idle() and time.monotonic() < deadline:
        time.sleep(0.05)


@pytest.fixture
def pdf_dir() -> Path:
    return get_settings().pdf_dir


def wait_done(client: TestClient, job_id: int, timeout: float = 60) -> dict:
    """Follow a job through the long-poll endpoint until it finishes."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/api/pdf/jobs/{job_id}", params={"wait": 10})
        assert res.status_code == 200, res.text
        job = res.json()
        if job["status"] in ("done", "failed"):
            return job
    raise AssertionError(f"job {job_id} did not finish")


def upload(client: TestClient, data: bytes, name: str = "doc.pdf"):
    return client.post(
        "/api/pdf/imports",
        files={"file": (name, data, "application/pdf")},
        headers=w(client),
    )


def import_pdf(client: TestClient, data: bytes, name: str = "doc.pdf") -> dict:
    res = upload(client, data, name)
    assert res.status_code == 202, res.text
    return wait_done(client, res.json()["id"])


def export(client: TestClient, source_type: str, source_id: int, lang: str = "en") -> dict:
    res = client.post(
        "/api/pdf/exports",
        json={"source_type": source_type, "source_id": source_id, "lang": lang},
        headers=w(client),
    )
    assert res.status_code == 202, res.text
    return wait_done(client, res.json()["id"])


def text_pdf(pages: list[str]) -> bytes:
    """A plain text PDF (as a word processor would make), with a Unicode font."""
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        page.insert_font(fontname="dejavu", fontfile=str(FONT))
        page.insert_text((72, 72), text, fontname="dejavu", fontsize=11)
    return doc.tobytes()


def image_only_pdf(pages: int = 1) -> bytes:
    """What a scanner produces: each page is a picture, with no text layer."""
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
    pix.set_rect(pix.irect, (200, 200, 200))
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page().insert_image(pymupdf.Rect(50, 50, 450, 250), pixmap=pix)
    return doc.tobytes()


@pytest.fixture
def project(logged_in) -> int:
    res = logged_in.post(
        "/api/projects", json={"name": "Acme Corp", "type": "bounty_program"}, headers=w(logged_in)
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.fixture
def report(logged_in, project) -> dict:
    res = logged_in.post(
        "/api/reports",
        json={
            "project_id": project,
            "title": "SQL injection — «Тест» oʻzbek",
            "type": "bbp",
            "severity": "high",
            "cvss_score": "8.6",
            "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N",
            "body_md": TRILINGUAL_MD,
        },
        headers=w(logged_in),
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.fixture
def note(logged_in, project) -> dict:
    res = logged_in.post(
        "/api/notes",
        json={
            "title": "Recon qaydlari — заметки",
            "project_id": project,
            "tags": ["recon", "todo"],
            "body_md": TRILINGUAL_MD,
        },
        headers=w(logged_in),
    )
    assert res.status_code == 201, res.text
    return res.json()
