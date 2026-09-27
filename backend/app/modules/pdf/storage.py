"""Private files of PDF jobs (D-83): uploaded PDFs and exported PDFs.

Same rules as evidence storage (D-62): one flat directory (0700), random 32-hex
names (0600), no user input in any path, temporary files renamed into place.
"""

import logging
import os
import re
import secrets
import time
from collections.abc import Iterable
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings

logger = logging.getLogger("hexops")

_NAME = re.compile(r"^[0-9a-f]{32}$")
TMP_PREFIX = ".tmp-"
_CHUNK = 64 * 1024


class TooLarge(Exception):
    pass


def jobs_dir() -> Path:
    path = get_settings().pdf_dir
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def new_name() -> str:
    return secrets.token_hex(16)


def path_for(name: str) -> Path:
    """The only way to turn a stored name into a path."""
    if not _NAME.fullmatch(name):
        raise ValueError("invalid job file name")
    base = jobs_dir().resolve()
    path = (base / name).resolve()
    if path.parent != base:
        raise ValueError("path escapes pdf_dir")
    return path


def temp_path() -> Path:
    return jobs_dir() / f"{TMP_PREFIX}{secrets.token_hex(8)}"


def _write_new(tmp: Path, chunks: Iterable[bytes], limit: int | None) -> int:
    size = 0
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as out:
        for chunk in chunks:
            size += len(chunk)
            if limit is not None and size > limit:
                raise TooLarge
            out.write(chunk)
    return size


def save_stream(source: BinaryIO, limit: int) -> tuple[str, int]:
    """Stream an upload to a new private file. Returns (name, size).

    Raises TooLarge past `limit`; on any failure nothing is left behind.
    """
    name = new_name()
    tmp = temp_path()
    try:
        size = _write_new(tmp, iter(lambda: source.read(_CHUNK), b""), limit)
        os.replace(tmp, path_for(name))
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return name, size


def save_bytes(data: bytes) -> str:
    name = new_name()
    tmp = temp_path()
    try:
        _write_new(tmp, [data], None)
        os.replace(tmp, path_for(name))
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return name


def remove(name: str | None) -> None:
    if not name:
        return
    try:
        path_for(name).unlink(missing_ok=True)
    except (OSError, ValueError):
        logger.error("Could not delete PDF job file %s", name)


def sweep_orphans(keep: set[str], older_than_seconds: int = 3600) -> int:
    """Delete temp files and files no job refers to, once they are old enough.

    The age check keeps a file that a job is being created for right now.
    """
    cutoff = time.time() - older_than_seconds
    removed = 0
    for path in jobs_dir().iterdir():
        if not path.is_file() or path.name in keep:
            continue
        if path.name.startswith(TMP_PREFIX) or _NAME.fullmatch(path.name):
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
    return removed
