"""Small, shared steps of install-linux.sh and install-windows.ps1 (one implementation).

    python scripts/install_helper.py make-env <example> <env> <database-url> <api-port> <ui-port>
    python scripts/install_helper.py port-free <port>
    python scripts/install_helper.py wait-http <url> [<url> ...] [--timeout SECONDS]
    python scripts/install_helper.py setup-status <ui-url>
    python scripts/install_helper.py secret
    (from backend/, with the virtual environment's Python:)
    python ../scripts/install_helper.py check-db
    python ../scripts/install_helper.py check-pdf

Exit code 0 means success; anything else is a failure with a message on stderr.
Secrets are written only into the new .env file, never printed.
"""

import json
import os
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def secret() -> str:
    return secrets.token_urlsafe(48)


def make_env(example: str, target: str, database_url: str, api_port: str, ui_port: str) -> None:
    """Create backend/.env from .env.example. Refuses to overwrite an existing file."""
    if not database_url.startswith("postgresql+psycopg://"):
        fail("The database URL must start with postgresql+psycopg://")
    for port in (api_port, ui_port):
        if not port.isdigit() or not 1 <= int(port) <= 65535:
            fail(f"Not a valid port: {port}")
    out = []
    with open(example, encoding="utf-8") as f:
        for line in f:
            if line.startswith("HEXOPS_DATABASE_URL="):
                line = f"HEXOPS_DATABASE_URL={database_url}\n"
            elif line.startswith("HEXOPS_SECRET_KEY="):
                line = f"HEXOPS_SECRET_KEY={secret()}\n"
            elif line.startswith(("HEXOPS_TEST_DATABASE_URL=", "HEXOPS_E2E_DATABASE_URL=")):
                line = "# " + line  # only for developers running the test suites
            out.append(line)
    out += [
        "\n# Written by the installer.\n",
        f"HEXOPS_PORT={api_port}\n",
        f"HEXOPS_UI_PORT={ui_port}\n",
    ]
    if ui_port != "4173":  # the default trusted origins cover 4173 (and 5173 for development)
        out.append(
            f"HEXOPS_TRUSTED_ORIGINS=http://127.0.0.1:{ui_port},http://localhost:{ui_port}\n"
        )
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        fail(f"{target} already exists; it is never overwritten.")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.writelines(out)


def port_free(port: str) -> None:
    """Fails only if something is listening. Like the servers themselves, this uses
    SO_REUSEADDR on Linux/macOS, so connections still in TIME_WAIT after a restart do
    not count; on Windows that option means something else and is not used."""
    s = socket.socket()
    if os.name != "nt":
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("127.0.0.1", int(port)))
    except OSError:
        fail(f"Port {port} is already in use.")
    finally:
        s.close()


def status(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=3) as res:  # noqa: S310 - local URLs only
            return res.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return 0


def wait_http(urls: list[str], timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if all(status(u) == 200 for u in urls):
            return
        time.sleep(1)
    fail("No answer from: " + ", ".join(u for u in urls if status(u) != 200))


def setup_status(ui_url: str) -> None:
    with urllib.request.urlopen(f"{ui_url}/api/auth/setup", timeout=5) as res:  # noqa: S310
        print("required" if json.load(res)["required"] else "done")


def check_db() -> None:
    sys.path.insert(0, os.getcwd())
    try:
        from sqlalchemy import text

        from app.core.db import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - the message is for the person installing
        # The driver's message can contain the host and user, never the password.
        fail(
            f"Cannot connect to PostgreSQL: {type(exc).__name__}: {str(exc).splitlines()[0][:200]}"
        )


def check_pdf() -> None:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content("<p>ok</p>")
            ok = page.pdf()[:5] == b"%PDF-"
            browser.close()
    except Exception as exc:  # noqa: BLE001
        fail(f"Chromium cannot print a PDF: {type(exc).__name__}: {str(exc).splitlines()[0][:300]}")
    if not ok:
        fail("Chromium did not produce a PDF.")


def main(argv: list[str]) -> None:
    if not argv:
        fail(__doc__ or "")
    cmd, args = argv[0], argv[1:]
    if cmd == "make-env" and len(args) == 5:
        make_env(*args)
    elif cmd == "port-free" and len(args) == 1:
        port_free(args[0])
    elif cmd == "wait-http" and args:
        timeout = 60.0
        if "--timeout" in args:
            i = args.index("--timeout")
            timeout = float(args[i + 1])
            args = args[:i] + args[i + 2 :]
        wait_http(args, timeout)
    elif cmd == "setup-status" and len(args) == 1:
        setup_status(args[0])
    elif cmd == "secret" and not args:
        print(secret())
    elif cmd == "check-db" and not args:
        check_db()
    elif cmd == "check-pdf" and not args:
        check_pdf()
    else:
        fail(f"unknown command or wrong arguments: {' '.join(argv)}")


if __name__ == "__main__":
    main(sys.argv[1:])
