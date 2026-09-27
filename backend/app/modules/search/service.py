import re

from fastapi import status
from psycopg.errors import QueryCanceled
from sqlalchemy import func, select, text, union_all
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.textsearch import normalize, parse
from app.modules.notes import public as notes
from app.modules.reports import public as reports
from app.modules.search.schemas import SearchHit, SearchPage, SearchQuery

SNIPPET_CHARS = 200
TIMEOUT_MS = 5000  # a pathological query fails fast instead of tying up the server

_MARKDOWN = [
    (re.compile(r"```[^\n]*"), " "),  # fence lines
    (re.compile(r"!?\[([^\]]*)\]\([^)]*\)"), r"\1"),  # links and images: keep the text
    (re.compile(r"^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+", re.M), ""),  # block markers
    (re.compile(r"[*_~`|]+"), " "),  # emphasis, code ticks, table pipes
    (re.compile(r"\s+"), " "),
]


def _plain(markdown: str) -> str:
    out = markdown[:50_000]  # bounded work per hit
    for pattern, repl in _MARKDOWN:
        out = pattern.sub(repl, out)
    return out.strip()


def snippet(body: str, terms: list[str]) -> str:
    """A plain-text window around the first term found (or the start)."""
    plain = _plain(body)
    folded = normalize(plain).casefold()
    at = -1
    for term in terms:
        needle = normalize(term).casefold()
        # Stemmed matches ("уязвимости" for "уязвимость"): fall back to a prefix.
        for candidate in (needle, needle[: max(4, len(needle) - 3)]):
            i = folded.find(candidate)
            if i >= 0 and (at < 0 or i < at):
                at = i
                break
    # normalize() may drop apostrophes, so the index is approximate; that is fine.
    start = max(0, at - SNIPPET_CHARS // 3) if at >= 0 else 0
    piece = plain[start : start + SNIPPET_CHARS]
    return ("…" if start > 0 else "") + piece + ("…" if start + SNIPPET_CHARS < len(plain) else "")


def search(db: Session, q: SearchQuery) -> SearchPage:
    parsed = parse(q.q)
    empty = SearchPage(items=[], total=0, page=q.page, size=q.size, terms=[])
    if parsed.empty:
        return empty

    parts = []
    if q.kind in ("all", "report") and not q.tag:
        parts.append(reports.search_select(parsed))
    if q.kind in ("all", "note"):
        parts.append(notes.search_select(parsed, q.tag))
    if not parts:
        return empty
    hits = (union_all(*parts) if len(parts) > 1 else parts[0]).subquery()

    try:
        db.execute(text(f"SET LOCAL statement_timeout = {TIMEOUT_MS}"))
        # One pass: the total rides along with the page (count(*) OVER ()), so the
        # matches are scanned and ranked once, not once more for a separate count.
        # Measured on 20,000 records (D-85): median 203 -> 152 ms for a word in 97% of them.
        rows = db.execute(
            select(hits.c.kind, hits.c.id, hits.c.updated_at, func.count().over().label("total"))
            .order_by(hits.c.rank.desc(), hits.c.updated_at.desc(), hits.c.kind, hits.c.id.desc())
            .offset((q.page - 1) * q.size)
            .limit(q.size)
        ).all()
        if rows:
            total = rows[0].total
        else:  # past the last page (or nothing matched): count on its own
            total = db.scalar(select(func.count()).select_from(hits)) or 0
    except OperationalError as err:
        db.rollback()
        if isinstance(err.orig, QueryCanceled):
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "search_timeout", "Search took too long"
            ) from None
        raise

    details = {
        "report": reports.search_details(db, [r.id for r in rows if r.kind == "report"]),
        "note": notes.search_details(db, [r.id for r in rows if r.kind == "note"]),
    }
    terms = parsed.highlights
    items = []
    for r in rows:
        d = details[r.kind].get(r.id)
        if d is None:  # deleted between the two queries
            continue
        items.append(
            SearchHit(
                kind=r.kind,
                id=r.id,
                title=d.title,
                snippet=snippet(d.body, terms),
                project_id=d.project_id,
                project_name=d.project_name,
                updated_at=r.updated_at,
                severity=d.severity,
                status=d.status,
                tags=d.tags,
            )
        )
    return SearchPage(items=items, total=total, page=q.page, size=q.size, terms=terms)
