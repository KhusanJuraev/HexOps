"""Account management. There is no signup endpoint; the single user is created here.

python -m app.cli create-user <username>   (entry point: app/cli.py)
python -m app.cli set-password <username>
"""

import argparse
import getpass
import re
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH
from app.modules.auth.models import User
from app.modules.auth.schemas import USERNAME_PATTERN
from app.modules.auth.service import (
    SetupClosed,
    normalize_username,
    set_password,
    setup_owner,
)


def _prompt_password() -> str:
    password = getpass.getpass("Password: ")
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        sys.exit(f"Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters.")
    if getpass.getpass("Repeat password: ") != password:
        sys.exit("Passwords do not match.")
    return password


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("create-user", "set-password"):
        sub.add_parser(name).add_argument("username")
    args = parser.parse_args(argv)

    if not re.fullmatch(USERNAME_PATTERN, args.username):
        sys.exit("Username must be 3-64 characters: letters, digits, '_', '.', '-'.")
    username = normalize_username(args.username)

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if args.command == "create-user":
            closed = "A user already exists. HexOps v1 is single-user; use set-password."
            if db.scalar(select(User.id).limit(1)) is not None:
                sys.exit(closed)
            try:
                # Same path as the web setup, so the single-owner rule is enforced alike.
                setup_owner(db, username, _prompt_password())
            except SetupClosed:
                sys.exit(closed)
            print(f"Created user '{username}'.")
        else:
            if user is None:
                sys.exit(f"No user named '{username}'.")
            set_password(db, user, _prompt_password())
            print(f"Password updated for '{username}'. Existing sessions were signed out.")


if __name__ == "__main__":
    main()
