"""Markdown -> print HTML safety, translated labels, and migration 0007."""

import json
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import inspect

from alembic import command
from app.core.db import engine
from app.modules.pdf.labels import ENUMS, LABELS, LANGS
from app.modules.pdf.render import markdown_to_html
from tests.conftest import _test_url

LOCALES = Path(__file__).resolve().parents[3] / "frontend" / "src" / "shared" / "i18n" / "locales"


@pytest.mark.parametrize("lang", LANGS)
def test_enum_names_match_the_ui(lang):
    ui = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))["reports"]
    for key in ("type", "severity", "status"):
        assert ENUMS[lang][key] == ui[key], (lang, key)


def test_every_language_has_every_label():
    keys = set(LABELS["en"])
    assert all(set(LABELS[lang]) == keys for lang in LANGS)


@pytest.mark.parametrize(
    ("source", "absent", "present"),
    [
        ("<script>alert(1)</script>", ["<script"], ["&lt;script&gt;"]),
        ('<img src="x" onerror="alert(1)">', ["<img"], ["&lt;img"]),
        ("[a](javascript:alert(1))", ["href"], ["[a](javascript:alert(1))"]),
        ("[a](file:///etc/passwd)", ["href"], []),
        ("[a](data:text/html;base64,PHNjcmlwdD4=)", ["href"], []),
        ("![x](http://tracker.example/p.png)", ["<img", "src="], ["[Image: x]"]),
        ("![x](data:image/png;base64,AAAA)", ["<img", "src="], ["![x](data:"]),  # left as text
        ("[ok](https://example.com)", [], ['href="https://example.com"']),
        ("<style>body{background:url(http://x)}</style>", ["<style"], ["&lt;style&gt;"]),
    ],
)
def test_markdown_renders_inert_html(source, absent, present):
    html = markdown_to_html(source, "en")
    for s in absent:
        assert s not in html, (source, html)
    for s in present:
        assert s in html, (source, html)


def test_headings_sit_under_the_document_title():
    html = markdown_to_html("# One\n\n## Two\n\n###### Six", "en")
    assert "<h2>One</h2>" in html and "<h3>Two</h3>" in html and "<h6>Six</h6>" in html


def test_a_page_break_line_becomes_a_break_but_not_inside_code():
    html = markdown_to_html("a\n\n\\pagebreak\n\nb\n\n```\n\\pagebreak\n```", "en")
    assert html.count('class="page-break"') == 1
    assert "<code>\\pagebreak\n</code>" in html


def test_tables_task_lists_and_strikethrough():
    html = markdown_to_html("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~old~~", "en")
    assert "<table>" in html and "<td>1</td>" in html
    assert 'type="checkbox"' in html and "disabled" in html
    assert "<s>old</s>" in html


def _cfg() -> Config:
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.attributes["url"] = _test_url
    return cfg


def test_migration_0007_goes_down_and_up(logged_in):
    from tests.pdf.conftest import w

    note = logged_in.post("/api/notes", json={"title": "Survives"}, headers=w(logged_in)).json()
    command.downgrade(_cfg(), "0006")
    try:
        assert "pdf_jobs" not in inspect(engine).get_table_names()
    finally:
        command.upgrade(_cfg(), "head")
    assert "pdf_jobs" in inspect(engine).get_table_names()
    checks = {c["name"] for c in inspect(engine).get_check_constraints("pdf_jobs")}
    assert checks == {
        "ck_pdf_jobs_export_has_source",
        "ck_pdf_jobs_pdf_job_kind",
        "ck_pdf_jobs_pdf_source_type",
        "ck_pdf_jobs_pdf_job_status",
        "ck_pdf_jobs_progress_range",
    }
    assert logged_in.get(f"/api/notes/{note['id']}").json()["title"] == "Survives"


def test_pdf_dates_are_day_first_in_utc_without_shifting():
    from datetime import UTC, datetime, timedelta, timezone

    from app.modules.pdf.render import format_utc

    assert format_utc(datetime(2026, 6, 5, 9, 7, tzinfo=UTC)) == "05/06/2026 09:07 UTC"
    # 23:30 UTC on 31 January stays 31/01 in the PDF, even if the value came in +05:00.
    tashkent = timezone(timedelta(hours=5))
    assert format_utc(datetime(2026, 2, 1, 4, 30, tzinfo=tashkent)) == "31/01/2026 23:30 UTC"
    assert format_utc(datetime(2028, 2, 29, 0, 0, tzinfo=UTC)) == "29/02/2028 00:00 UTC"
