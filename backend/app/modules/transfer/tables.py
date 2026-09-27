"""Which rows a full export carries, and how each value travels as JSON (D-90).

Table-level on purpose, like pg_dump: every user-created row of every data table,
by column, so nothing is lost when modules add fields. Not exported: users and
sessions (the account belongs to the installation), pdf_jobs (temporary),
alembic_version, and generated columns (search_vector is recomputed on insert).
"""

import enum
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import (
    Boolean,
    Computed,
    Date,
    DateTime,
    Enum,
    Integer,
    Numeric,
    String,
    Table,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.core.db import Base

# Parent tables first (insert order); deletes run in reverse.
DATA_TABLES = (
    "projects",
    "project_scope_items",
    "reports",
    "report_attachments",
    "tags",
    "notes",
    "note_tags",
    "activity_logs",
)
# Tables with a serial id whose sequence is moved past the imported ids.
SERIAL_TABLES = (
    "projects",
    "project_scope_items",
    "reports",
    "report_attachments",
    "tags",
    "notes",
    "activity_logs",
)


class BadValue(Exception):
    pass


def table(name: str) -> Table:
    try:
        return Base.metadata.tables[name]
    except KeyError:  # the models are registered by app.models / the routers
        raise RuntimeError(f"table {name} is not registered") from None


def columns(name: str) -> list[str]:
    return [
        c.name
        for c in table(name).columns
        if not isinstance(c.server_default, Computed) and c.computed is None
    ]


def dump_value(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, enum.Enum):
        return value.value
    return value


def parse_value(name: str, column: str, value: Any) -> Any:
    """JSON value → what the column takes. Raises BadValue for the wrong type/shape."""
    col = table(name).columns[column]
    if value is None:
        if not col.nullable:
            raise BadValue(f"{name}.{column} is empty")
        return None
    t = col.type
    try:
        if isinstance(t, DateTime):
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None:
                raise ValueError
            return parsed
        if isinstance(t, Date):
            return date.fromisoformat(value)
        if isinstance(t, Numeric):
            if not isinstance(value, str):
                raise ValueError
            return Decimal(value)
        if isinstance(t, Enum):
            if t.enum_class is not None:
                return t.enum_class(value)
            if value not in t.enums:
                raise ValueError
            return value
        if isinstance(t, Boolean):
            if not isinstance(value, bool):
                raise ValueError
            return value
        if isinstance(t, Integer):
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValueError
            return value
        if isinstance(t, String | Text):
            if not isinstance(value, str) or (t.length is not None and len(value) > t.length):
                raise ValueError
            return value
        if isinstance(t, JSONB):
            return value
    except (ValueError, TypeError, InvalidOperation):
        raise BadValue(f"{name}.{column}") from None
    raise BadValue(f"{name}.{column}: unsupported type")
