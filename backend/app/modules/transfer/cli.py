"""Write an encrypted .hexops export from the command line (used before an uninstall).

python -m app.modules.transfer.cli export <path/to/file.hexops>

The same archive as Settings → Data → Export, readable by Import on any HexOps. The
passphrase is asked twice at a hidden prompt (or read from standard input when there is
no terminal) and is never printed. An existing file is never overwritten. Run it while
the HexOps server is stopped, or at least idle: the export reads one consistent snapshot.
"""

import argparse
import getpass
import os
import shutil
import sys
import zipfile
from pathlib import Path

from sqlalchemy import select

import app.models  # noqa: F401 - registers every table, as the server does at startup
from app.core.db import SessionLocal
from app.modules.auth.public import User
from app.modules.transfer import jobs, storage
from app.modules.transfer.models import TransferJob

MIN_PASSPHRASE = 12
MAX_PASSPHRASE = 1024


def _read_passphrase(prompt: str) -> str:
    if sys.stdin.isatty():
        return getpass.getpass(prompt)
    line = sys.stdin.readline()
    return line.rstrip("\r\n")


def _passphrase() -> str:
    first = _read_passphrase("Passphrase for the export (12+ characters): ")
    if not MIN_PASSPHRASE <= len(first) <= MAX_PASSPHRASE:
        sys.exit(f"The passphrase must be {MIN_PASSPHRASE}-{MAX_PASSPHRASE} characters.")
    if _read_passphrase("Repeat the passphrase: ") != first:
        sys.exit("The passphrases do not match.")
    return first


def export(target: Path) -> None:
    target = target.expanduser().resolve()
    if target.exists():
        sys.exit(f"{target} already exists; it is never overwritten.")
    if not target.parent.is_dir():
        sys.exit(f"The folder {target.parent} does not exist.")
    with SessionLocal() as db:
        running = db.scalar(
            select(TransferJob.id).where(TransferJob.status.in_(jobs.UNFINISHED)).limit(1)
        )
        if running is not None:
            sys.exit("Another export or import is running in HexOps; try again when it ends.")
        owner_id = db.scalar(select(User.id).order_by(User.id).limit(1)) or 0
    passphrase = _passphrase()

    print("Writing the encrypted export ...", flush=True)
    tmp, manifest = jobs.write_archive(passphrase, owner_id, lambda *_: None)
    try:
        # Prove the file opens with this passphrase before anyone relies on it.
        plain = jobs._decrypt(tmp, passphrase)
        try:
            with zipfile.ZipFile(plain) as z:
                if z.testzip() is not None:
                    sys.exit("The export failed its own check; nothing was saved.")
        finally:
            plain.unlink(missing_ok=True)
        partial = target.with_name(target.name + ".partial")
        shutil.copyfile(tmp, partial)
        os.chmod(partial, 0o600)
        os.replace(partial, target)
    finally:
        tmp.unlink(missing_ok=True)
    counts = {name: meta["rows"] for name, meta in manifest["tables"].items() if meta["rows"]}
    files = manifest["totals"]["files"]
    print(f"Saved {target} ({target.stat().st_size} bytes).")
    print(f"Contains: {counts or 'no records'}; {files} evidence file(s).")
    print("Keep the passphrase: without it the export cannot be opened.")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.modules.transfer.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("export").add_argument("path", type=Path)
    args = parser.parse_args(argv)
    storage.transfer_dir()  # the private working folder must exist
    export(args.path)


if __name__ == "__main__":
    main()
