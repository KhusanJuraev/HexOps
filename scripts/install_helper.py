"""Small, shared steps of install-linux.sh and install-windows.ps1 (one implementation).

    python scripts/install_helper.py make-env <example> <env> <database-url> <api-port> <ui-port>
    python scripts/install_helper.py port-free <port>
    python scripts/install_helper.py wait-http <url> [<url> ...] [--timeout SECONDS]
    python scripts/install_helper.py setup-status <ui-url>
    python scripts/install_helper.py secret
    (from backend/, with the virtual environment's Python:)
    python ../scripts/install_helper.py check-db
    python ../scripts/install_helper.py check-pdf
    (with the virtual environment's Python, from anywhere:)
    python scripts/install_helper.py install-browser

Exit code 0 means success; anything else is a failure with a message on stderr.
Secrets are written only into the new .env file, never printed.
"""

import http.server
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass


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


# --- PDF renderer (Playwright's Chromium headless shell) --------------------------------------
#
# install-browser runs `playwright install --only-shell chromium`. If that fails, it downloads
# the same archives itself from the official URLs that the installed Playwright package
# reports (`install --dry-run`), with curl when available (or urllib), verifies them, and
# serves them to Playwright from a server bound to 127.0.0.1 so that Playwright still does
# its own extraction and bookkeeping. Nothing is written into the repository; the archives
# live in a temporary folder that is removed afterwards. TLS is always verified.

INSTALL_ARGS = ["install", "--only-shell", "chromium"]
HOST_VARS = (
    "PLAYWRIGHT_DOWNLOAD_HOST",
    "PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST",
    "PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST",
    "PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST",
)
MARKER = "INSTALLATION_COMPLETE"  # written by Playwright when a component is installed
_TITLE = re.compile(r"^\S.*\(playwright (?P<key>\S+ v\S+)\)\s*$")
_FIELD = re.compile(
    r"^\s+(?P<name>Install location|Download url|Download fallback \d+):\s+(?P<value>\S.*?)\s*$"
)


class BrowserInstallError(Exception):
    pass


@dataclass
class Component:
    key: str  # "chromium-headless-shell v1243"
    title: str
    directory: str
    urls: list[str]

    def installed(self) -> bool:
        return os.path.isfile(os.path.join(self.directory, MARKER))


def parse_dry_run(text: str) -> list[Component]:
    """Parse `playwright install --dry-run` output into its components, in order."""
    out: list[Component] = []
    for line in text.splitlines():
        m = _TITLE.match(line)
        if m:
            out.append(Component(m["key"], line.strip(), "", []))
            continue
        f = _FIELD.match(line)
        if f and out:
            if f["name"] == "Install location":
                out[-1].directory = f["value"]
            else:
                out[-1].urls.append(f["value"])
    return out


def _run(args: list[str], **kw) -> subprocess.CompletedProcess:
    """Run a fixed program (Playwright, curl, Node.js) with list arguments, no shell."""
    return subprocess.run(args, capture_output=True, text=True, **kw)  # noqa: S603


def playwright_cmd() -> list[str]:
    return [sys.executable, "-m", "playwright"]


def official_env(base: dict[str, str] | None = None) -> dict[str, str]:
    """The environment without download-host overrides: Playwright's own URLs."""
    env = dict(os.environ if base is None else base)
    for var in HOST_VARS:
        env.pop(var, None)
    return env


def local_env(base_url: str, base: dict[str, str] | None = None) -> dict[str, str]:
    """Point every Playwright download at the local server. Proxies are bypassed for it:
    Playwright sends plain-http requests through HTTP(S)_PROXY unless NO_PROXY says not to."""
    env = official_env(base)
    for var in HOST_VARS:
        env[var] = base_url
    for var in ("NO_PROXY", "no_proxy"):
        env[var] = ",".join(x for x in ("127.0.0.1", "localhost", env.get(var, "")) if x)
    return env


def dry_run(cmd: list[str], env: dict[str, str]) -> list[Component]:
    res = _run([*cmd, *INSTALL_ARGS, "--dry-run"], env=env, timeout=120)
    if res.returncode != 0:
        raise BrowserInstallError(
            "`playwright install --dry-run` failed: " + (res.stderr or res.stdout).strip()[-500:]
        )
    comps = parse_dry_run(res.stdout)
    if not comps or any(not c.directory or not c.urls for c in comps):
        raise BrowserInstallError(
            "could not read the download list from `playwright install --dry-run`"
        )
    return comps


def expected_size(headers: str) -> int | None:
    """Content-Length of the last response in a header dump (after any redirects)."""
    blocks = [b for b in re.split(r"\r?\n\r?\n", headers) if b.strip()]
    if not blocks:
        return None
    m = re.search(r"^content-length:\s*(\d+)\s*$", blocks[-1], re.I | re.M)
    return int(m.group(1)) if m else None


def verify_archive(path: str, size: int | None) -> None:
    """A complete download: the size the server announced, and a zip whose every entry
    passes its CRC check."""
    have = os.path.getsize(path)
    if size is not None and have != size:
        raise BrowserInstallError(f"incomplete download: {have} of {size} bytes")
    try:
        with zipfile.ZipFile(path) as z:
            bad = z.testzip()
    except zipfile.BadZipFile as exc:
        raise BrowserInstallError(f"not a valid zip archive ({exc})") from exc
    if bad is not None:
        raise BrowserInstallError(f"corrupt archive (entry {bad} fails its CRC check)")


def _curl_download(curl: str, url: str, dest: str) -> int | None:
    headers = dest + ".headers"
    # https only (also after redirects); abort if slower than 1 KB/s for 60 s. No -k: TLS is
    # verified with the system's certificate store (Schannel on Windows).
    args = [curl, "--fail", "--location", "--silent", "--show-error", "--proto", "=https",
            "--proto-redir", "=https", "--connect-timeout", "30", "--retry", "3",
            "--speed-limit", "1024", "--speed-time", "60", "--dump-header", headers,
            "--output", dest, url]  # fmt: skip
    try:
        res = _run(args)
        if res.returncode != 0:
            msg = (res.stderr.strip().splitlines() or [""])[-1]
            raise BrowserInstallError(f"curl exit code {res.returncode}: {msg}")
        with open(headers, encoding="latin-1") as f:
            return expected_size(f.read())
    finally:
        if os.path.exists(headers):
            os.remove(headers)


def _urllib_download(url: str, dest: str) -> int | None:
    # https only: download_official() refuses any other scheme before calling this.
    req = urllib.request.Request(url, headers={"User-Agent": "HexOps installer"})  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=60) as res, open(dest, "wb") as f:  # noqa: S310
            if not res.geturl().startswith("https://"):
                raise BrowserInstallError("redirected away from https")
            size = res.headers.get("Content-Length")
            shutil.copyfileobj(res, f, 1024 * 1024)
            return int(size) if size and size.isdigit() else None
    except (urllib.error.URLError, OSError) as exc:
        raise BrowserInstallError(f"{type(exc).__name__}: {exc}") from exc


def download_official(urls: list[str], dest: str, curl: str | None) -> str:
    """Download the first of `urls` that works into `dest`, verified. Returns that URL."""
    errors = []
    for url in urls:
        if not url.startswith("https://"):
            errors.append(f"{url}: not an https URL, skipped")
            continue
        try:
            size = _curl_download(curl, url, dest) if curl else _urllib_download(url, dest)
            verify_archive(dest, size)
            return url
        except BrowserInstallError as exc:
            errors.append(f"{url}: {exc}")
            if os.path.exists(dest):
                os.remove(dest)
    raise BrowserInstallError("download failed from every official URL:\n  " + "\n  ".join(errors))


class LocalArchiveServer:
    """Serves exactly the given {url path: file} map on 127.0.0.1 (random port); every
    other path is 404. Runs in a thread of this process and stops in __exit__."""

    def __init__(self, routes: dict[str, str]):
        self.routes = routes
        self.served: list[str] = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _send(self, body: bool) -> None:
                path = urllib.parse.urlsplit(self.path).path
                file = outer.routes.get(path)
                if file is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(os.path.getsize(file)))
                self.end_headers()
                if body:
                    with open(file, "rb") as f:
                        shutil.copyfileobj(f, self.wfile, 1024 * 1024)
                    outer.served.append(path)

            def do_GET(self) -> None:  # noqa: N802 - http.server API
                self._send(True)

            def do_HEAD(self) -> None:  # noqa: N802
                self._send(False)

            def log_message(self, *args: object) -> None:
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> "LocalArchiveServer":
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self._thread.join(timeout=10)


def _tail(text: str, lines: int = 6) -> str:
    """The last meaningful lines of Playwright's output (no stack frames, no progress bars)."""
    keep = [x.strip() for x in text.splitlines() if x.strip()]
    keep = [x for x in keep if not x.startswith("at ") and "|" not in x]
    return "\n".join("      " + x[:300] for x in keep[-lines:])


NODE_PROBE = (  # like curl --location --range 0-1048575, with a 20 s idle timeout
    "const g=(u,k)=>{const r=require('https').get(u,{headers:{Range:'bytes=0-1048575'}},s=>{"
    "if(s.statusCode>=300&&s.statusCode<400&&s.headers.location&&k<5){s.resume();"
    "return g(new URL(s.headers.location,u).toString(),k+1)}"
    "let n=0;s.on('data',c=>n+=c.length);"
    "s.on('end',()=>console.log('HTTP '+s.statusCode+', '+n+' bytes'))});"
    "r.setTimeout(20000,()=>{console.log('no data for 20 s');r.destroy()});"
    "r.on('error',e=>console.log(e.code||e.message))};g(process.argv[1],0)"
)


def diagnose(url: str, curl: str | None) -> list[str]:
    """Facts for the error report: can Playwright's bundled Node.js and curl each fetch the
    first megabyte of `url`? Reported as observations, not as a diagnosis."""
    names = ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy")
    proxies = [v for v in names if os.environ.get(v)]  # names only: values may hold passwords
    notes = ["proxy variables set: " + (", ".join(proxies) if proxies else "none")]
    try:
        from playwright._impl._driver import compute_driver_executable

        node = str(compute_driver_executable()[0])
        res = _run([node, "-e", NODE_PROBE, url], timeout=60)
        seen = res.stdout.strip() or res.stderr.strip()[-200:]
        notes.append(f"Playwright's Node.js ({node}), first 1 MB: {seen}")
    except Exception as exc:  # noqa: BLE001 - diagnostics only
        notes.append(f"Playwright's Node.js could not be tested: {type(exc).__name__}")
    if curl:
        fmt = "HTTP %{http_code}, %{size_download} bytes"
        args = [curl, "--silent", "--show-error", "--location", "--proto", "=https",
                "--max-time", "30", "--range", "0-1048575", "--output", os.devnull,
                "--write-out", fmt, url]  # fmt: skip
        try:
            res = _run(args, timeout=60)
            seen = (res.stdout or res.stderr).strip()[-200:]
        except subprocess.TimeoutExpired:
            seen = "no answer within 60 s"
        notes.append(f"curl ({curl}), first 1 MB: {seen}")
    return notes


def install_browser(
    cmd: list[str] | None = None, curl: str | None = None, skip_normal: bool = False
) -> str:
    """Install Playwright's Chromium headless shell. Returns "normal", "already" or
    "fallback"; raises BrowserInstallError with an actionable message otherwise."""
    cmd = cmd or playwright_cmd()
    curl = curl if curl is not None else (shutil.which("curl") or "")
    if not skip_normal:
        print("    Downloading with Playwright (this can take a few minutes) ...", flush=True)
        res = _run([*cmd, *INSTALL_ARGS])
        if res.returncode == 0:
            return "normal"
        print("    Playwright's own download failed:", file=sys.stderr)
        print(_tail(res.stdout + "\n" + res.stderr), file=sys.stderr)

    comps = dry_run(cmd, official_env())
    missing = [c for c in comps if not c.installed()]
    if not missing:
        return "already"
    print("    Observations for troubleshooting:")
    for note in diagnose(missing[0].urls[0], curl or None):
        print("      - " + note)
    print("    Downloading " + ", ".join(c.key for c in missing) + " from the official URLs"
          + (" with curl" if curl else "") + " ...")  # fmt: skip
    tmp = tempfile.mkdtemp(prefix="hexops-browser-")
    try:
        files = {}
        for i, c in enumerate(missing):
            dest = os.path.join(tmp, f"{i}.zip")
            used = download_official(c.urls, dest, curl or None)
            files[c.key] = dest
            print(f"      {c.key}: {os.path.getsize(dest)} bytes, verified ({used})")
        with LocalArchiveServer({}) as server:
            env = local_env(server.base_url)
            local = {c.key: c for c in dry_run(cmd, env)}
            for key, dest in files.items():
                if key not in local:
                    raise BrowserInstallError(f"Playwright no longer lists {key}")
                server.routes[urllib.parse.urlsplit(local[key].urls[0]).path] = dest
            res = _run([*cmd, *INSTALL_ARGS], env=env)
            if res.returncode != 0:
                raise BrowserInstallError(
                    "Playwright could not install the downloaded archives:\n"
                    + _tail(res.stdout + "\n" + res.stderr)
                )
        still = [c.key for c in missing if not c.installed()]
        if still:
            raise BrowserInstallError("not installed after the fallback: " + ", ".join(still))
        return "fallback"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def install_browser_cli() -> None:
    sys.stdout.reconfigure(line_buffering=True)  # keep progress and errors in order when piped
    try:
        how = install_browser()
    except (BrowserInstallError, subprocess.TimeoutExpired, OSError) as exc:
        fail(
            f"Could not install the PDF renderer: {exc}\n"
            "  Your database, backend/.env and data are unchanged; run the installer again"
            " to retry.\n"
            "  If it keeps failing: allow outbound HTTPS (port 443) for the programs named above\n"
            "  in your firewall/antivirus, or set HTTPS_PROXY if your network needs a proxy."
        )
    if how == "fallback":
        print("    Installed with the installer's own download (Playwright's download had failed).")


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
    elif cmd == "install-browser" and not args:
        install_browser_cli()
    else:
        fail(f"unknown command or wrong arguments: {' '.join(argv)}")


if __name__ == "__main__":
    main(sys.argv[1:])
