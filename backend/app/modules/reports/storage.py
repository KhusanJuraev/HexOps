"""Evidence bytes on disk (D-62).

- Files live flat in settings.uploads_dir under a random 32-hex-character name.
  No user input ever becomes part of a path: names are generated here and checked
  against a strict pattern before use.
- Uploads are streamed to a temporary file in the same directory, checked, then
  atomically renamed. Nothing is executed, and nothing is served inline.
- The type is decided from an allowlisted extension AND the file's content; the
  client's Content-Type header is ignored.
"""

import codecs
import hashlib
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings

logger = logging.getLogger("hexops")

_NAME = re.compile(r"^[0-9a-f]{32}$")
_TMP_PREFIX = ".tmp-"
_CHUNK = 64 * 1024

IMAGE_SIGNATURES = {
    "png": (b"\x89PNG\r\n\x1a\n", "image/png"),
    "jpg": (b"\xff\xd8\xff", "image/jpeg"),
    "jpeg": (b"\xff\xd8\xff", "image/jpeg"),
    "gif": (b"GIF8", "image/gif"),
}
TEXT_EXTENSIONS = frozenset(
    "txt log md csv json xml yaml yml har http req".split()  # notes, logs, captures
    + "py js ts rb go c h cpp java php sh ps1 sql html htm".split()  # PoC source
)
TEXT_TYPE = "text/plain; charset=utf-8"  # all text, including HTML PoCs: never rendered


class UploadRejected(Exception):
    def __init__(self, code: str, status_code: int = 422) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@dataclass
class StoredFile:
    storage_name: str
    content_type: str
    size_bytes: int
    sha256: str


def uploads_dir() -> Path:
    path = get_settings().uploads_dir
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def path_for(storage_name: str) -> Path:
    """The only way to turn a stored name into a path."""
    if not _NAME.fullmatch(storage_name):
        raise ValueError("invalid storage name")
    base = uploads_dir().resolve()
    path = (base / storage_name).resolve()
    if path.parent != base:  # defence in depth; the pattern already forbids separators
        raise ValueError("path escapes uploads_dir")
    return path


def extension_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _content_type(ext: str, head: bytes) -> str:
    if ext in IMAGE_SIGNATURES:
        signature, content_type = IMAGE_SIGNATURES[ext]
        if head.startswith(signature):
            return content_type
        raise UploadRejected("attachment_content_mismatch")
    if ext == "webp":
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            return "image/webp"
        raise UploadRejected("attachment_content_mismatch")
    if ext == "pdf":
        if head.startswith(b"%PDF-"):
            return "application/pdf"
        raise UploadRejected("attachment_content_mismatch")
    if ext in TEXT_EXTENSIONS:
        return TEXT_TYPE  # UTF-8 validity is checked while streaming
    raise UploadRejected("attachment_type_not_allowed")


def store(source: BinaryIO, filename: str) -> StoredFile:
    """Stream `source` into uploads_dir. On any failure nothing is left behind."""
    max_bytes = get_settings().max_upload_bytes
    ext = extension_of(filename)
    if ext not in IMAGE_SIGNATURES and ext not in TEXT_EXTENSIONS and ext not in ("pdf", "webp"):
        raise UploadRejected("attachment_type_not_allowed")

    directory = uploads_dir()
    storage_name = secrets.token_hex(16)
    tmp = directory / f"{_TMP_PREFIX}{secrets.token_hex(8)}"
    digest = hashlib.sha256()
    size = 0
    head = b""
    decoder = codecs.getincrementaldecoder("utf-8")() if ext in TEXT_EXTENSIONS else None
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out:
            while chunk := source.read(_CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadRejected("attachment_too_large", 413)
                if len(head) < 16:
                    head = (head + chunk)[:16]
                if decoder is not None:
                    if b"\x00" in chunk:
                        raise UploadRejected("attachment_content_mismatch")
                    try:
                        decoder.decode(chunk)
                    except UnicodeDecodeError:
                        raise UploadRejected("attachment_content_mismatch") from None
                digest.update(chunk)
                out.write(chunk)
            if decoder is not None:
                try:
                    decoder.decode(b"", final=True)
                except UnicodeDecodeError:
                    raise UploadRejected("attachment_content_mismatch") from None
        if size == 0:
            raise UploadRejected("attachment_empty")
        content_type = _content_type(ext, head)
        os.replace(tmp, path_for(storage_name))
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return StoredFile(storage_name, content_type, size, digest.hexdigest())


def remove(storage_name: str) -> None:
    """Delete a stored file; a missing file is logged, not fatal."""
    try:
        path_for(storage_name).unlink()
    except FileNotFoundError:
        logger.warning("Evidence file already missing: %s", storage_name)
    except (OSError, ValueError):
        logger.error("Could not delete evidence file %s", storage_name)


def sweep_temp_files(older_than_seconds: int = 3600) -> int:
    """Remove temporary files left by a crash mid-upload. Returns how many."""
    directory = uploads_dir()
    cutoff = time.time() - older_than_seconds
    removed = 0
    for path in directory.glob(f"{_TMP_PREFIX}*"):
        if path.is_file() and path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            removed += 1
    return removed
