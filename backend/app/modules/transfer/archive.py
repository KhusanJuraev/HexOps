"""What is inside a .hexops archive, how it is written, and how it is checked (D-90).

Inside the encryption (container.py) is a ZIP:

    manifest.json            format, versions, counts, sizes and SHA-256 of everything
    data/<table>.json        {"columns": [...], "rows": [[...], ...]} for each data table
    files/<storage name>     each evidence file's bytes (32 hex characters, as stored)

Nothing in an archive is trusted: `inspect` checks every entry name, size, count and
checksum, every column and value, duplicate ids and every relationship before an
import may touch live data.
"""

import hashlib
import json
import re
import stat
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.modules.reports import public as reports
from app.modules.transfer.tables import (
    DATA_TABLES,
    BadValue,
    columns,
    dump_value,
    parse_value,
    table,
)

FORMAT = "hexops-export"
FORMAT_VERSION = 1
_FILE = re.compile(r"^files/([0-9a-f]{32})$")
_DATA = re.compile(r"^data/([a-z_]+)\.json$")
_MAX_MANIFEST = 64 * 1024 * 1024
_COPY = 1024 * 1024


class ArchiveError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail  # never shown with record content; names and counts only


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def schema_version(db: Session) -> str:
    return db.scalar(text("SELECT version_num FROM alembic_version")) or ""


# --- export ------------------------------------------------------------------------------


def write(
    db: Session, zip_out: BinaryIO, owner: str, app_version: str, progress: Callable[[int], None]
) -> dict[str, Any]:
    """Write one consistent snapshot into `zip_out` (the encrypting writer).

    The caller holds the maintenance flag (no writes) and `db` is in a REPEATABLE READ,
    read-only transaction, so rows and files belong to the same moment.
    """
    manifest: dict[str, Any] = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "schema_version": schema_version(db),
        "app_version": app_version,
        "created_at": datetime.now(UTC).isoformat(),
        "source_owner": owner,
        "tables": {},
        "files": [],
    }
    attachments: list[dict[str, Any]] = []
    with zipfile.ZipFile(zip_out, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for i, name in enumerate(DATA_TABLES):
            cols = columns(name)
            tbl = table(name)
            keys = [tbl.columns[c] for c in (k.name for k in tbl.primary_key.columns)]
            rows = [
                [dump_value(v) for v in row]
                for row in db.execute(select(*[tbl.columns[c] for c in cols]).order_by(*keys))
            ]
            if name == "report_attachments":
                attachments = [dict(zip(cols, r, strict=True)) for r in rows]
            payload = json.dumps({"columns": cols, "rows": rows}, ensure_ascii=False).encode()
            path = f"data/{name}.json"
            zf.writestr(path, payload)
            manifest["tables"][name] = {
                "path": path,
                "rows": len(rows),
                "size": len(payload),
                "sha256": _sha(payload),
            }
            progress(5 + int(25 * (i + 1) / len(DATA_TABLES)))

        total = sum(a["size_bytes"] for a in attachments) or 1
        done = 0
        for a in attachments:
            source = reports.evidence_path(a["storage_name"])
            digest, size = hashlib.sha256(), 0
            try:
                with (
                    source.open("rb") as fh,
                    zf.open(f"files/{a['storage_name']}", "w", force_zip64=True) as dst,
                ):
                    while chunk := fh.read(_COPY):
                        digest.update(chunk)
                        size += len(chunk)
                        dst.write(chunk)
            except FileNotFoundError:
                raise ArchiveError("transfer_source_file_missing", a["storage_name"]) from None
            if size != a["size_bytes"] or digest.hexdigest() != a["sha256"]:
                raise ArchiveError("transfer_source_file_changed", a["storage_name"])
            manifest["files"].append(
                {"path": f"files/{a['storage_name']}", "size": size, "sha256": a["sha256"]}
            )
            done += size
            progress(30 + int(60 * done / total))

        manifest["totals"] = {
            "records": sum(t["rows"] for t in manifest["tables"].values()),
            "files": len(manifest["files"]),
            "file_bytes": sum(f["size"] for f in manifest["files"]),
            "unpacked_bytes": sum(t["size"] for t in manifest["tables"].values())
            + sum(f["size"] for f in manifest["files"]),
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=1, ensure_ascii=False).encode())
    return manifest


# --- import: inspection ---------------------------------------------------------------------


@dataclass
class Limits:
    max_entries: int
    max_unpacked_bytes: int


@dataclass
class Package:
    manifest: dict[str, Any]
    rows: dict[str, list[dict[str, Any]]] = field(default_factory=dict)  # parsed, per table
    files: dict[str, dict[str, Any]] = field(default_factory=dict)  # storage name → size/sha256


def _read_entry(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    if info.file_size > limit:
        raise ArchiveError("transfer_too_large", info.filename)
    with zf.open(info) as fh:
        data = fh.read(limit + 1)
    if len(data) > limit:
        raise ArchiveError("transfer_too_large", info.filename)
    return data


def _check_entries(zf: zipfile.ZipFile, limits: Limits) -> dict[str, zipfile.ZipInfo]:
    infos = zf.infolist()
    if len(infos) > limits.max_entries:
        raise ArchiveError("transfer_too_many_entries", str(len(infos)))
    entries: dict[str, zipfile.ZipInfo] = {}
    unpacked = 0
    for info in infos:
        name = info.filename
        if name in entries:
            raise ArchiveError("transfer_duplicate_entry", name)
        if name != "manifest.json" and not _DATA.match(name) and not _FILE.match(name):
            raise ArchiveError("transfer_unsafe_path", name)  # includes ../, /abs, dirs
        if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 0x1:
            raise ArchiveError("transfer_unsafe_path", name)  # symlinks, zip-encrypted parts
        unpacked += info.file_size
        entries[name] = info
    if unpacked > limits.max_unpacked_bytes:
        raise ArchiveError("transfer_too_large", "unpacked size")
    return entries


def _check_manifest(raw: bytes, current_schema: str) -> dict[str, Any]:
    try:
        manifest = json.loads(raw)
    except ValueError:
        raise ArchiveError("transfer_corrupt", "manifest") from None
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise ArchiveError("transfer_corrupt", "manifest format")
    if manifest.get("format_version") != FORMAT_VERSION:
        raise ArchiveError("transfer_unsupported_version", str(manifest.get("format_version")))
    if manifest.get("schema_version") != current_schema:
        raise ArchiveError(
            "transfer_schema_mismatch", f"{manifest.get('schema_version')} ≠ {current_schema}"
        )
    if set(manifest.get("tables", {})) != set(DATA_TABLES) or not isinstance(
        manifest.get("files"), list
    ):
        raise ArchiveError("transfer_corrupt", "manifest tables")
    return manifest


def _load_table(zf, entries, name: str, meta: dict[str, Any], limit: int) -> list[dict[str, Any]]:  # noqa: ANN001
    path = f"data/{name}.json"
    if meta.get("path") != path or path not in entries:
        raise ArchiveError("transfer_missing_file", path)
    raw = _read_entry(zf, entries[path], limit)
    if len(raw) != meta.get("size") or _sha(raw) != meta.get("sha256"):
        raise ArchiveError("transfer_checksum_mismatch", path)
    try:
        doc = json.loads(raw)
    except ValueError:
        raise ArchiveError("transfer_corrupt", path) from None
    expected = columns(name)
    if (
        not isinstance(doc, dict)
        or doc.get("columns") != expected
        or not isinstance(doc.get("rows"), list)
    ):
        raise ArchiveError("transfer_corrupt", f"{name} columns")
    if len(doc["rows"]) != meta.get("rows"):
        raise ArchiveError("transfer_checksum_mismatch", f"{name} row count")
    parsed = []
    for row in doc["rows"]:
        if not isinstance(row, list) or len(row) != len(expected):
            raise ArchiveError("transfer_corrupt", f"{name} row shape")
        try:
            parsed.append({c: parse_value(name, c, v) for c, v in zip(expected, row, strict=True)})
        except BadValue as exc:
            raise ArchiveError("transfer_invalid_data", str(exc)) from None
    return parsed


def _unique(rows: list[dict[str, Any]], key: tuple[str, ...], what: str) -> set:
    seen: set = set()
    for r in rows:
        k = tuple(r[c] for c in key)
        if k in seen:
            raise ArchiveError("transfer_duplicate_id", what)
        seen.add(k)
    return seen


def _check_relations(rows: dict[str, list[dict[str, Any]]]) -> None:
    ids = {name: {r["id"] for r in rows[name]} for name in DATA_TABLES if name != "note_tags"}
    for name in DATA_TABLES:
        key = ("note_id", "tag_id") if name == "note_tags" else ("id",)
        _unique(rows[name], key, name)
    _unique(rows["tags"], ("name",), "tags.name")
    _unique(rows["report_attachments"], ("storage_name",), "report_attachments.storage_name")

    def refs(name: str, column: str, target: str, nullable: bool = False) -> None:
        for r in rows[name]:
            v = r[column]
            if (v is None and not nullable) or (v is not None and v not in ids[target]):
                raise ArchiveError("transfer_broken_reference", f"{name}.{column}")

    refs("project_scope_items", "project_id", "projects")
    refs("reports", "project_id", "projects")
    refs("report_attachments", "report_id", "reports")
    refs("notes", "project_id", "projects", nullable=True)
    refs("note_tags", "note_id", "notes")
    refs("note_tags", "tag_id", "tags")
    for a in rows["report_attachments"]:
        if not re.fullmatch(r"[0-9a-f]{32}", a["storage_name"]):
            raise ArchiveError("transfer_unsafe_path", "storage name")


def inspect(
    zip_path: Path, current_schema: str, limits: Limits, progress: Callable[[int], None]
) -> Package:
    """Check everything; return the parsed rows and file list. Raises ArchiveError."""
    try:
        zf = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError):
        raise ArchiveError("transfer_corrupt", "zip") from None
    with zf:
        entries = _check_entries(zf, limits)
        if "manifest.json" not in entries:
            raise ArchiveError("transfer_missing_file", "manifest.json")
        manifest = _check_manifest(
            _read_entry(zf, entries["manifest.json"], _MAX_MANIFEST), current_schema
        )
        package = Package(manifest=manifest)
        for i, name in enumerate(DATA_TABLES):
            package.rows[name] = _load_table(
                zf, entries, name, manifest["tables"][name], limits.max_unpacked_bytes
            )
            progress(10 + int(30 * (i + 1) / len(DATA_TABLES)))
        _check_relations(package.rows)

        # Files: exactly one per attachment row, with the recorded size and checksum.
        declared = {}
        for f in manifest["files"]:
            m = _FILE.match(str(f.get("path", ""))) if isinstance(f, dict) else None
            if not m or m.group(1) in declared:
                raise ArchiveError("transfer_corrupt", "manifest files")
            declared[m.group(1)] = f
        wanted = {a["storage_name"]: a for a in package.rows["report_attachments"]}
        present = {m.group(1) for n in entries if (m := _FILE.match(n))}
        if set(declared) != set(wanted):
            raise ArchiveError("transfer_missing_file", "manifest and attachments differ")
        if missing := set(wanted) - present:
            raise ArchiveError("transfer_missing_file", f"{len(missing)} evidence file(s)")
        if extra := present - set(wanted):
            raise ArchiveError("transfer_unexpected_file", f"{len(extra)} file(s)")
        total = sum(a["size_bytes"] for a in wanted.values()) or 1
        done = 0
        for name, a in wanted.items():
            digest, size = hashlib.sha256(), 0
            with zf.open(entries[f"files/{name}"]) as fh:
                while chunk := fh.read(_COPY):
                    size += len(chunk)
                    if size > a["size_bytes"]:
                        break
                    digest.update(chunk)
            d = declared[name]
            if not (
                size == a["size_bytes"] == d.get("size")
                and digest.hexdigest() == a["sha256"] == d.get("sha256")
            ):
                raise ArchiveError("transfer_checksum_mismatch", "evidence file")
            package.files[name] = {"size": size, "sha256": a["sha256"]}
            done += size
            progress(40 + int(50 * done / total))
    return package


def extract_files(zip_path: Path, files: dict[str, dict[str, Any]], target: Path) -> None:
    """Write the evidence files into `target` (0600), re-checking every checksum."""
    with zipfile.ZipFile(zip_path) as zf:
        for name, expected in files.items():
            dest = target / name
            digest = hashlib.sha256()
            with zf.open(f"files/{name}") as src, dest.open("xb") as out:
                dest.chmod(0o600)
                while chunk := src.read(_COPY):
                    digest.update(chunk)
                    out.write(chunk)
            if digest.hexdigest() != expected["sha256"]:
                raise ArchiveError("transfer_checksum_mismatch", "evidence file")
