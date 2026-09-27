"""Shared text-search rules for Reports and Notes (D-76).

Two matching paths, chosen per term:

* Words go to PostgreSQL full-text search over a stored tsvector built three ways:
  'simple' (exact words; Uzbek has no stemmer), 'english' and 'russian' (stems, so
  "exploits" finds "exploit" and "уязвимости" finds "уязвимость"). The query is
  run through the same three configurations and OR-ed.
* Identifier-like terms (a dot, colon, slash, @, or a digit next to a hyphen:
  domains, IPs, URLs, e-mails, CVE ids, paths) use a case-insensitive substring
  match served by trigram indexes, because the tokenizer keeps "api.example.com"
  as one token and splits "CVE-2024-12345" oddly.

Apostrophe variants (ʻ ‘ ’ ' ` ʼ) are removed on both sides, so Uzbek
"koʻrinish", "ko'rinish" and "korinish" all match. All terms must match (AND).
Bounds: at most 8 terms of at most 100 characters each.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from sqlalchemy import ColumnElement, and_, case, cast, func, literal, or_, true
from sqlalchemy.dialects.postgresql import REGCONFIG

APOSTROPHES = "ʻ‘’'`ʼ"
MAX_TERMS = 8
MAX_TERM_LENGTH = 100
MIN_FRAGMENT_LENGTH = 3  # trigram indexes need three characters
# Only the first 100,000 characters of a body are indexed for full-text search;
# identifier fragments still match anywhere in the body.
FTS_BODY_CHARS = 100_000
CONFIGS = ("simple", "english", "russian")

_IDENTIFIER = re.compile(r"[.:/@\\]|\d-|-\d")
_EDGE_PUNCTUATION = '"()[]{}<>,;!?«»“”'


def search_vector_sql(title: str, body: str) -> str:
    """SQL for the stored tsvector column (used by the models and migration 0006)."""
    quoted = APOSTROPHES.replace("'", "''")

    def text(column: str, limit: int | None = None) -> str:
        source = f"left({column}, {limit})" if limit else column
        return f"translate(coalesce({source}, ''), '{quoted}', '')"

    parts = [
        f"setweight(to_tsvector('{cfg}'::regconfig, {text(col, lim)}), '{weight}')"
        for col, lim, weight in ((title, None, "A"), (body, FTS_BODY_CHARS, "B"))
        for cfg in CONFIGS
    ]
    return " || ".join(parts)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    return text.translate({ord(ch): None for ch in APOSTROPHES})


@dataclass
class ParsedQuery:
    words: list[str] = field(default_factory=list)
    fragments: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.words and not self.fragments

    @property
    def highlights(self) -> list[str]:
        """What the UI may highlight in titles and snippets."""
        return [t for t in self.words + self.fragments if len(t) >= 2]


def parse(query: str) -> ParsedQuery:
    parsed = ParsedQuery()
    for raw in query.split()[:MAX_TERMS]:
        term = raw.strip(_EDGE_PUNCTUATION)[:MAX_TERM_LENGTH]
        if not term:
            continue
        if _IDENTIFIER.search(term) and len(term) >= MIN_FRAGMENT_LENGTH:
            # Keep the original form (apostrophes are irrelevant in identifiers).
            parsed.fragments.append(term)
        else:
            word = normalize(term)
            if any(ch.isalnum() for ch in word):
                parsed.words.append(word)
    return parsed


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def tsquery(words: list[str]) -> ColumnElement:
    """The words as one query per configuration, OR-ed (plainto: no operators)."""
    text = " ".join(words)
    queries = [func.plainto_tsquery(cast(literal(cfg), REGCONFIG), text) for cfg in CONFIGS]
    combined = queries[0]
    for q in queries[1:]:
        combined = combined.op("||")(q)
    return combined


def match(
    parsed: ParsedQuery, vector: ColumnElement, title: ColumnElement, body: ColumnElement
) -> tuple[ColumnElement[bool], ColumnElement]:
    """(WHERE condition, rank expression) for one searchable table."""
    conditions: list[ColumnElement[bool]] = []
    rank: ColumnElement = literal(0.0)
    if parsed.words:
        q = tsquery(parsed.words)
        conditions.append(vector.op("@@")(q))
        rank = func.ts_rank_cd(vector, q)
    title_hits: list[ColumnElement[bool]] = []
    for fragment in parsed.fragments:
        like = f"%{_escape_like(fragment)}%"
        in_title = title.ilike(like, escape="\\")
        title_hits.append(in_title)
        conditions.append(or_(in_title, body.ilike(like, escape="\\")))
    if title_hits:
        # An identifier in the title counts for more than one in the body.
        rank = rank + case((and_(*title_hits), 1.0), else_=0.0)
    return (and_(*conditions) if conditions else true()), rank


@dataclass
class SearchDetail:
    """What one search hit shows; each searchable module fills these in."""

    title: str
    body: str
    project_id: int | None
    project_name: str | None
    severity: str | None = None
    status: str | None = None
    tags: list[str] | None = None
