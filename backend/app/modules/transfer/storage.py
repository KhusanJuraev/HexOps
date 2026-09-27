"""Private working files of full-data transfers (D-90).

settings.transfer_dir (0700) holds encrypted archives under random 32-hex names (0600)
and, only while a job runs, a decrypted ZIP (".plain-*"). settings.backups_dir (0700)
keeps the verified pre-import backups. No user input ever becomes part of a path.
"""

import os
import re
import secrets
import shutil
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings

_NAME = re.compile(r"^[0-9a-f]{32}$")
PLAIN_PREFIX = ".plain-"
TMP_PREFIX = ".tmp-"
_CHUNK = 1024 * 1024


class TooLarge(Exception):
    pass


def _private_dir(path: Path) -> Path:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def transfer_dir() -> Path:
    return _private_dir(get_settings().transfer_dir)


def backups_dir() -> Path:
    return _private_dir(get_settings().backups_dir)


def path_for(name: str) -> Path:
    if not _NAME.fullmatch(name):
        raise ValueError("invalid transfer file name")
    return transfer_dir() / name


def new_temp(prefix: str = TMP_PREFIX) -> Path:
    path = transfer_dir() / f"{prefix}{secrets.token_hex(8)}"
    os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
    return path


def publish(tmp: Path) -> str:
    """Move a finished temp file to a permanent random name; return the name."""
    name = secrets.token_hex(16)
    os.replace(tmp, path_for(name))
    return name


def save_stream(source: BinaryIO, limit: int) -> tuple[str, int, bytes]:
    """Stream an upload into the transfer dir. Returns (name, size, first 8 bytes)."""
    tmp = new_temp()
    size, head = 0, b""
    try:
        with tmp.open("wb") as out:
            while chunk := source.read(_CHUNK):
                size += len(chunk)
                if size > limit:
                    raise TooLarge
                if len(head) < 8:
                    head = (head + chunk)[:8]
                out.write(chunk)
        return publish(tmp), size, head
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def remove(name: str | None) -> None:
    if name:
        try:
            path_for(name).unlink(missing_ok=True)
        except ValueError:
            pass


def remove_tree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def sweep_temp() -> None:
    """Delete decrypted and temporary files left by an interrupted job (startup only)."""
    for path in transfer_dir().iterdir():
        if path.is_file() and path.name.startswith((PLAIN_PREFIX, TMP_PREFIX)):
            path.unlink(missing_ok=True)


def free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def tree_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) if path.exists() else 0
