"""Stage 6 search: languages, identifiers, filters, pagination, bounds, indexes (D-76)."""

import pytest
from sqlalchemy import select, text
from sqlalchemy.dialects import postgresql

from app.core.db import SessionLocal
from app.core.textsearch import parse
from app.modules.notes import public as notes_public
from app.modules.reports import public as reports_public
from app.modules.search import service
from tests.conftest import ORIGIN


def w(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["hexops_csrf"], "Origin": ORIGIN}


@pytest.fixture
def seed(logged_in):
    c = logged_in
    pid = c.post(
        "/api/projects", json={"name": "Acme", "type": "bounty_program"}, headers=w(c)
    ).json()["id"]

    def report(title: str, body: str) -> int:
        body_json = {
            "project_id": pid,
            "title": title,
            "type": "bbp",
            "severity": "high",
            "body_md": body,
        }
        return c.post("/api/reports", json=body_json, headers=w(c)).json()["id"]

    def note(title: str, body: str, tags: list[str] | None = None) -> int:
        return c.post(
            "/api/notes", json={"title": title, "body_md": body, "tags": tags or []}, headers=w(c)
        ).json()["id"]

    return {
        "c": c,
        "en": report("Stored XSS", "Multiple exploits were found in the profile page."),
        "ru": note("Разведка", "Найдены уязвимости в сервере авторизации.", ["recon"]),
        "uz": note("Tizimga koʻrinish", "Kirish sahifasi oʻzbek tilida.", ["recon", "todo"]),
        "cve": report("Library issue", "Affected by CVE-2024-12345 in libfoo 1.2."),
        "ip": note(
            "Hosts",
            "Host 192.168.10.5 has port 8443 open. See api.example.com and https://app.example.com/login?next=/admin",
            ["recon"],
        ),
        "mail": note("Contacts", "Security contact: sec@vendor.example"),
        "report": report,
        "note": note,
    }


def search(client, **params) -> dict:
    res = client.get("/api/search", params=params)
    assert res.status_code == 200, res.text
    return res.json()


def ids(client, **params) -> set[tuple[str, int]]:
    return {(h["kind"], h["id"]) for h in search(client, size=50, **params)["items"]}


# --- access and validation ---------------------------------------------------------


def test_requires_a_session(client):
    assert client.get("/api/search", params={"q": "x"}).status_code == 401


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"q": ""},
        {"q": "x" * 201},
        {"q": "x", "size": 51},
        {"q": "x", "page": 0},
        {"q": "x", "kind": "project"},
        {"q": "x", "tag": "bad tag"},
        {"q": "x", "extra": 1},
    ],
)
def test_invalid_parameters(logged_in, params):
    assert logged_in.get("/api/search", params=params).status_code == 422


def test_query_without_searchable_terms_returns_nothing(seed):
    assert search(seed["c"], q="!! ??")["total"] == 0


# --- languages -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("q", "key"),
    [
        ("exploit", "en"),  # English stem of "exploits"
        ("EXPLOITS", "en"),  # case-insensitive
        ("profile page", "en"),  # every word must match
        ("уязвимость", "ru"),  # Russian stem of "уязвимости"
        ("сервер", "ru"),
        ("разведка", "ru"),  # title
        ("koʻrinish", "uz"),  # Uzbek: every apostrophe form matches
        ("ko'rinish", "uz"),
        ("ko‘rinish", "uz"),
        ("korinish", "uz"),
        ("oʻzbek", "uz"),
        ("Tizimga", "uz"),
    ],
)
def test_words_in_three_languages(seed, q, key):
    kind = "report" if key in ("en", "cve") else "note"
    assert (kind, seed[key]) in ids(seed["c"], q=q)


def test_all_words_must_match(seed):
    assert ids(seed["c"], q="exploits уязвимости") == set()


# --- identifiers: the substring fallback ----------------------------------------------------


@pytest.mark.parametrize(
    ("q", "key", "found"),
    [
        ("CVE-2024-12345", "cve", True),
        ("cve-2024-12345", "cve", True),
        ("2024-12345", "cve", True),
        ("CVE-2023-99999", "cve", False),
        ("192.168.10.5", "ip", True),
        ("192.168.10.50", "ip", False),
        ("api.example.com", "ip", True),
        ("example.com", "ip", True),  # a suffix of the host: full-text alone would miss it
        ("EXAMPLE.COM", "ip", True),
        ("/login?next", "ip", True),
        ("https://app.example.com", "ip", True),
        ("sec@vendor.example", "mail", True),
        ("vendor.example", "mail", True),
    ],
)
def test_identifiers(seed, q, key, found):
    kind = "report" if key == "cve" else "note"
    assert ((kind, seed[key]) in ids(seed["c"], q=q)) is found


def test_word_and_identifier_together(seed):
    assert ids(seed["c"], q="port 192.168.10.5") == {("note", seed["ip"])}
    assert ids(seed["c"], q="exploit 192.168.10.5") == set()


def test_like_wildcards_are_literal(seed):
    seed["note"]("Discount", "code 50%.off applies")
    assert ids(seed["c"], q="50%.off") != set()
    assert ids(seed["c"], q="5_%.off") == set()


# --- filters, ranking, results ---------------------------------------------------------------


def test_kind_and_tag_filters(seed):
    c = seed["c"]
    assert ids(c, q="recon hosts") == set()
    both = ids(c, q="example.com")
    assert both == {("note", seed["ip"])}
    assert {k for k, _ in ids(c, q="in", kind="report")} <= {"report"}
    assert ids(c, q="kirish", tag="recon") == {("note", seed["uz"])}
    assert ids(c, q="kirish", tag=["recon", "todo"]) == {("note", seed["uz"])}
    assert ids(c, q="192.168.10.5", tag="todo") == set()
    assert ids(c, q="exploit", tag="recon") == set()  # tags imply notes
    assert ids(c, q="exploit", kind="note") == set()


def test_title_matches_rank_first(seed):
    body_only = seed["note"]("Unrelated", "mentions zebra once")
    in_title = seed["note"]("Zebra crossing", "nothing else")
    hits = search(seed["c"], q="zebra")["items"]
    assert [h["id"] for h in hits][:2] == [in_title, body_only]


def test_hits_carry_a_short_snippet_not_the_body(seed):
    long_body = "filler " * 2000 + "the needle is here " + "tail " * 2000
    nid = seed["note"]("Haystack", long_body)
    [hit] = search(seed["c"], q="needle")["items"]
    assert hit["id"] == nid and hit["kind"] == "note"
    assert "needle" in hit["snippet"] and len(hit["snippet"]) <= 202
    assert hit["snippet"].startswith("…") and hit["snippet"].endswith("…")
    assert "body_md" not in hit
    assert search(seed["c"], q="needle")["terms"] == ["needle"]


def test_report_hits_carry_status_and_project(seed):
    [hit] = search(seed["c"], q="exploit")["items"]
    assert (hit["kind"], hit["project_name"], hit["status"], hit["severity"]) == (
        "report",
        "Acme",
        "draft",
        "high",
    )


def test_pagination_is_stable_and_complete(seed):
    made = {seed["note"](f"Needle {i:02d}", "haystack") for i in range(25)}
    pages = [search(seed["c"], q="needle", size=10, page=p) for p in (1, 2, 3, 4)]
    assert [p["total"] for p in pages] == [25] * 4
    got = [h["id"] for p in pages for h in p["items"]]
    assert len(got) == 25 and set(got) == made  # no duplicates, nothing missing
    assert pages[3]["items"] == []


# --- bounds and indexes --------------------------------------------------------------------------


def test_at_most_eight_terms_are_used():
    assert len(parse(" ".join(f"w{i}" for i in range(20))).words) == 8


def test_slow_queries_are_cut_off(seed, monkeypatch):
    real = notes_public.search_select

    def slow(parsed, tags):
        return real(parsed, tags).where(text("pg_sleep(0.2) IS NOT NULL"))

    monkeypatch.setattr(service.notes, "search_select", slow)
    monkeypatch.setattr(service, "TIMEOUT_MS", 50)
    res = seed["c"].get("/api/search", params={"q": "kirish", "kind": "note"})
    assert res.status_code == 422 and res.json()["code"] == "search_timeout"
    assert seed["c"].get("/api/auth/me").status_code == 200  # the session is fine afterwards


def _plan(stmt) -> str:
    sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    with SessionLocal() as db:
        db.execute(
            text("SET enable_seqscan = off")
        )  # tiny tables: force the planner to show indexes
        return "\n".join(r[0] for r in db.execute(text("EXPLAIN " + sql)))


@pytest.mark.parametrize(
    ("builder", "q", "index"),
    [
        (lambda p: reports_public.search_select(p), "exploit", "ix_reports_search_vector"),
        (lambda p: notes_public.search_select(p, []), "exploit", "ix_notes_search_vector"),
        (lambda p: reports_public.search_select(p), "example.com", "ix_reports_body_trgm"),
        (lambda p: notes_public.search_select(p, []), "example.com", "ix_notes_title_trgm"),
    ],
)
def test_queries_can_use_the_search_indexes(seed, builder, q, index):
    plan = _plan(builder(parse(q)))
    assert index in plan, plan


def test_list_endpoints_still_skip_the_vector(seed):
    with SessionLocal() as db:
        from app.modules.notes.models import Note

        note = db.scalar(select(Note))
        assert "search_vector" not in note.__dict__  # deferred: never loaded by default
