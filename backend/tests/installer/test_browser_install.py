"""install_helper.py install-browser: Playwright's download failing, the fallback, retries.

Offline: a fake Playwright CLI and a fake curl stand in for the real programs. The fake
Playwright behaves like the real one where it matters: `--dry-run` prints the same format,
download hosts come from PLAYWRIGHT_*DOWNLOAD_HOST, a download from the network "times
out", a download from 127.0.0.1 goes over real HTTP and is extracted, and a component
counts as installed once its INSTALLATION_COMPLETE marker exists.
"""

import importlib.util
import io
import os
import socket
import stat
import sys
import tempfile
import textwrap
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("install_helper", ROOT / "scripts/install_helper.py")
helper = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(helper)

# Real output of Playwright 1.63 `install --dry-run --only-shell chromium` with
# PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=win64 (install locations shortened). On real Windows a
# Winldd block follows in the same format.
WINDOWS_DRY_RUN = """\
Chrome Headless Shell 153.0.8010.12 (playwright chromium-headless-shell v1243)
  Install location:    C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1243
  Download url:        https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip

FFmpeg (playwright ffmpeg v1011)
  Install location:    C:\\Users\\me\\AppData\\Local\\ms-playwright\\ffmpeg-1011
  Download url:        https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip
  Download fallback 1: https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip
  Download fallback 2: https://cdn.playwright.dev/builds/ffmpeg/1011/ffmpeg-win64.zip
"""  # noqa: E501 - real output

# name, title, dir, path, official mirrors (the fake's own "browsers.json")
FAKE_PLAYWRIGHT = r"""
import io, os, sys, urllib.request, zipfile
COMPONENTS = [
    ("chromium-headless-shell",
     "Chrome Headless Shell 9.0.1 (playwright chromium-headless-shell v12)",
     "chromium_headless_shell-12", "builds/cft/9.0.1/win64/chrome-headless-shell-win64.zip",
     ["https://cdn.example.test"]),
    ("ffmpeg", "FFmpeg (playwright ffmpeg v34)", "ffmpeg-34", "builds/ffmpeg/34/ffmpeg-win64.zip",
     ["https://cdn.example.test/dbazure/download/playwright",
      "https://mirror.example.test/dbazure/download/playwright", "https://cdn.example.test"]),
    ("winldd", "Winldd (playwright winldd v56)", "winldd-56", "builds/winldd/56/winldd-win64.zip",
     ["https://cdn.example.test/dbazure/download/playwright",
      "https://mirror.example.test/dbazure/download/playwright"]),
]
root = os.environ["PLAYWRIGHT_BROWSERS_PATH"]
def urls(name, path, mirrors):
    var = "PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST" if name.startswith("chromium") else None
    host = (var and os.environ.get(var)) or os.environ.get("PLAYWRIGHT_DOWNLOAD_HOST")
    return [f"{m}/{path}" for m in ([host] if host else mirrors)]
args = sys.argv[1:]
assert args[:3] == ["install", "--only-shell", "chromium"], args
if "--dry-run" in args:
    for name, title, d, path, mirrors in COMPONENTS:
        print(title)
        print(f"  Install location:    {os.path.join(root, d)}")
        u = urls(name, path, mirrors)
        print(f"  Download url:        {u[0]}")
        for i, f in enumerate(u[1:]):
            print(f"  Download fallback {i + 1}: {f}")
        print()
    sys.exit(0)
network_down = set(os.environ.get("FAKE_PW_STALL", "").split(","))
with open(os.path.join(root, "requests.log"), "a") as log:
    for name, title, d, path, mirrors in COMPONENTS:
        target = os.path.join(root, d)
        if os.path.exists(os.path.join(target, "INSTALLATION_COMPLETE")):
            continue
        url = urls(name, path, mirrors)[0]
        log.write(url + "\n")
        if url.startswith("http://127.0.0.1:"):
            data = urllib.request.urlopen(url, timeout=10).read()
            zipfile.ZipFile(io.BytesIO(data)).extractall(target)
        elif name in network_down or "all" in network_down:
            print(f"Downloading {title} from {url}")
            print(f"Error: Request to {url} timed out after 30000ms", file=sys.stderr)
            print("    at Socket._onTimeout (node:net:824:8)", file=sys.stderr)
            sys.exit(1)
        else:
            os.makedirs(target, exist_ok=True)
        open(os.path.join(target, "INSTALLATION_COMPLETE"), "w").close()
"""

# Writes a small valid zip for the URL. FAKE_CURL_FAIL: hosts that fail (exit 28, like a
# timeout); FAKE_CURL_TRUNCATE: hosts that deliver a cut-off file with the full length.
FAKE_CURL = r"""
import io, os, sys, urllib.parse, zipfile
a = sys.argv[1:]
url, dest, headers = a[-1], a[a.index("--output") + 1], a[a.index("--dump-header") + 1]
assert "--insecure" not in a and "-k" not in a
with open(os.environ["FAKE_CURL_LOG"], "a") as log:
    log.write(url + "\n")
host = urllib.parse.urlsplit(url).hostname
if host in os.environ.get("FAKE_CURL_FAIL", "").split(","):
    print("curl: (28) Operation timed out after 60000 milliseconds", file=sys.stderr)
    sys.exit(28)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("payload.txt", ("archive from " + url + "\n") * 2000)
data = buf.getvalue()
with open(headers, "w") as h:
    h.write("HTTP/1.1 307 Temporary Redirect\r\nLocation: https://x/\r\nContent-Length: 0\r\n\r\n")
    h.write(f"HTTP/1.1 200 OK\r\nContent-Length: {len(data)}\r\n\r\n")
if host in os.environ.get("FAKE_CURL_TRUNCATE", "").split(","):
    data = data[: len(data) // 2]
with open(dest, "wb") as f:
    f.write(data)
"""


def _script(path: Path, body: str) -> Path:
    path.write_text(textwrap.dedent(body))
    return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Fake Playwright + fake curl, a private browsers folder and a private temp folder."""
    browsers = tmp_path / "browsers"
    browsers.mkdir()
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    pw = _script(tmp_path / "fake_playwright.py", FAKE_PLAYWRIGHT)
    curl = _script(tmp_path / "curl", "#!" + sys.executable + "\n" + FAKE_CURL)
    curl.chmod(curl.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(browsers))
    monkeypatch.setenv("FAKE_CURL_LOG", str(tmp_path / "curl.log"))
    monkeypatch.setattr(tempfile, "tempdir", str(tmp))
    for var in helper.HOST_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(helper, "diagnose", lambda url, curl: ["(diagnostics skipped in tests)"])

    class Env:
        cmd = [sys.executable, str(pw)]
        curl_path = str(curl)
        root = browsers
        temp = tmp

        def run(self, **kw):
            return helper.install_browser(cmd=self.cmd, curl=self.curl_path, **kw)

        def installed(self):
            return sorted(d.name for d in browsers.iterdir() if (d / helper.MARKER).exists())

        def requests(self):
            log = browsers / "requests.log"
            return log.read_text().split() if log.exists() else []

        def curl_urls(self):
            log = tmp_path / "curl.log"
            return log.read_text().split() if log.exists() else []

    return Env()


ALL = ["chromium_headless_shell-12", "ffmpeg-34", "winldd-56"]


# --- parsing and verification ---------------------------------------------------------------


def test_dry_run_output_is_parsed_with_every_url():
    comps = helper.parse_dry_run(WINDOWS_DRY_RUN)
    assert [c.key for c in comps] == ["chromium-headless-shell v1243", "ffmpeg v1011"]
    assert comps[0].directory.endswith("chromium_headless_shell-1243")
    assert comps[0].urls == [
        "https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip"
    ]
    assert len(comps[1].urls) == 3
    assert comps[1].urls[1].startswith("https://playwright.download.prss.microsoft.com/")


def test_content_length_comes_from_the_final_response_after_redirects():
    headers = (
        "HTTP/1.1 307 Temporary Redirect\r\nContent-Length: 0\r\nLocation: /x\r\n\r\n"
        'HTTP/2 200\r\ncontent-length: 120200717\r\netag: "abc"\r\n\r\n'
    )
    assert helper.expected_size(headers) == 120200717
    assert helper.expected_size("HTTP/1.1 200 OK\r\n\r\n") is None


def _zip(path: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "hello " * 1000)
    path.write_bytes(buf.getvalue())
    return buf.getvalue()


def test_archive_verification_rejects_short_corrupt_and_non_zip_files(tmp_path):
    good = tmp_path / "good.zip"
    data = _zip(good)
    helper.verify_archive(str(good), len(data))  # complete: no error
    helper.verify_archive(str(good), None)  # no Content-Length: the zip check still runs

    with pytest.raises(helper.BrowserInstallError, match="incomplete download"):
        helper.verify_archive(str(good), len(data) + 1)

    cut = tmp_path / "cut.zip"
    cut.write_bytes(data[: len(data) // 2])
    with pytest.raises(helper.BrowserInstallError, match="not a valid zip"):
        helper.verify_archive(str(cut), None)

    flipped = bytearray(data)
    flipped[40] ^= 0xFF  # inside the compressed data of a.txt
    bad = tmp_path / "bad.zip"
    bad.write_bytes(bytes(flipped))
    with pytest.raises(helper.BrowserInstallError):
        helper.verify_archive(str(bad), len(data))


def test_download_uses_the_next_official_url_and_never_plain_http(env, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CURL_FAIL", "cdn.example.test")
    dest = tmp_path / "a.zip"
    used = helper.download_official(
        [
            "http://cdn.example.test/x.zip",
            "https://cdn.example.test/x.zip",
            "https://mirror.example.test/x.zip",
        ],
        str(dest),
        env.curl_path,
    )
    assert used == "https://mirror.example.test/x.zip"
    assert env.curl_urls() == [
        "https://cdn.example.test/x.zip",
        "https://mirror.example.test/x.zip",
    ]
    assert dest.exists()


def test_a_truncated_download_is_rejected_and_removed(env, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CURL_TRUNCATE", "cdn.example.test")
    dest = tmp_path / "a.zip"
    with pytest.raises(helper.BrowserInstallError, match="incomplete download"):
        helper.download_official(["https://cdn.example.test/x.zip"], str(dest), env.curl_path)
    assert not dest.exists()
    assert not Path(str(dest) + ".headers").exists()


# --- the local server -------------------------------------------------------------------------


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=10) as res:  # noqa: S310 - http://127.0.0.1 only
        return res.read()


def test_local_server_is_loopback_only_serves_listed_paths_and_stops(tmp_path):
    archive = tmp_path / "a.zip"
    data = _zip(archive)
    with helper.LocalArchiveServer({"/builds/ffmpeg/34/ffmpeg-win64.zip": str(archive)}) as srv:
        assert srv.httpd.server_address[0] == "127.0.0.1"
        assert _get(srv.base_url + "/builds/ffmpeg/34/ffmpeg-win64.zip") == data
        for path in ("/", "/a.zip", "/builds/ffmpeg/34/", "/../a.zip", "/builds/ffmpeg/34/x.zip"):
            with pytest.raises(urllib.error.HTTPError) as e:
                _get(srv.base_url + path)
            assert e.value.code == 404
        port = srv.httpd.server_address[1]
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=2)


def test_local_env_redirects_every_host_and_bypasses_proxies(monkeypatch):
    base = {"PATH": "x", "NO_PROXY": "corp.example", "PLAYWRIGHT_DOWNLOAD_HOST": "https://mirror"}
    env = helper.local_env("http://127.0.0.1:5555", base)
    assert all(env[v] == "http://127.0.0.1:5555" for v in helper.HOST_VARS)
    assert env["NO_PROXY"].split(",") == ["127.0.0.1", "localhost", "corp.example"]
    assert "127.0.0.1" in env["no_proxy"]
    assert not any(v in helper.official_env(base) for v in helper.HOST_VARS)


# --- install-browser: failure, fallback, retry -------------------------------------------------


def test_normal_download_needs_no_fallback(env):
    assert env.run() == "normal"
    assert env.installed() == ALL
    assert env.curl_urls() == []


def test_stalled_playwright_download_falls_back_to_verified_official_archives(env, monkeypatch):
    # As reported on Windows: Chromium times out, and so do FFmpeg and Winldd.
    monkeypatch.setenv("FAKE_PW_STALL", "all")
    assert env.run() == "fallback"
    assert env.installed() == ALL
    # Every archive came from its official https URL...
    assert env.curl_urls() == [
        "https://cdn.example.test/builds/cft/9.0.1/win64/chrome-headless-shell-win64.zip",
        "https://cdn.example.test/dbazure/download/playwright/builds/ffmpeg/34/ffmpeg-win64.zip",
        "https://cdn.example.test/dbazure/download/playwright/builds/winldd/56/winldd-win64.zip",
    ]
    # ...and Playwright installed each one from the loopback server, at its own path.
    local = [u for u in env.requests() if u.startswith("http://127.0.0.1:")]
    assert [u.split("/", 3)[3] for u in local] == [
        "builds/cft/9.0.1/win64/chrome-headless-shell-win64.zip",
        "builds/ffmpeg/34/ffmpeg-win64.zip",
        "builds/winldd/56/winldd-win64.zip",
    ]
    assert (env.root / "ffmpeg-34" / "payload.txt").exists()  # extracted by "Playwright"
    assert list(env.temp.iterdir()) == []  # the downloaded archives are gone


def test_only_the_components_that_failed_are_downloaded_again(env, monkeypatch):
    # Chromium installs normally, FFmpeg stalls (the second situation in the report). Like
    # Playwright, the fake stops at the first failure, so Winldd is still missing too.
    monkeypatch.setenv("FAKE_PW_STALL", "ffmpeg")
    assert env.run() == "fallback"
    assert env.installed() == ALL
    assert [u.rsplit("/", 1)[1] for u in env.curl_urls()] == [
        "ffmpeg-win64.zip",
        "winldd-win64.zip",
    ]


def test_fallback_failure_is_reported_cleaned_up_and_a_retry_resumes(env, monkeypatch):
    monkeypatch.setenv("FAKE_PW_STALL", "all")
    monkeypatch.setenv("FAKE_CURL_FAIL", "cdn.example.test,mirror.example.test")
    with pytest.raises(helper.BrowserInstallError) as e:
        env.run()
    msg = str(e.value)
    assert "download failed from every official URL" in msg
    assert "curl exit code 28" in msg
    assert "chrome-headless-shell-win64.zip" in msg
    assert env.installed() == []
    assert list(env.temp.iterdir()) == []

    # The network comes back for curl only; Playwright's own download still stalls.
    monkeypatch.delenv("FAKE_CURL_FAIL")
    assert env.run() == "fallback"
    assert env.installed() == ALL

    # Third run: everything is installed, nothing is downloaded again.
    before = len(env.curl_urls())
    monkeypatch.delenv("FAKE_PW_STALL")
    assert env.run() == "normal"
    assert len(env.curl_urls()) == before


def test_a_mirror_is_used_when_the_first_official_url_fails(env, monkeypatch):
    monkeypatch.setenv("FAKE_PW_STALL", "ffmpeg")
    monkeypatch.setenv("FAKE_CURL_FAIL", "cdn.example.test")
    assert env.run() == "fallback"
    assert env.installed() == ALL
    hosts = [u.split("/")[2] for u in env.curl_urls()]
    assert hosts == ["cdn.example.test", "mirror.example.test"] * 2


def test_the_users_own_download_host_is_not_used_for_the_fallback(env, monkeypatch):
    # A custom mirror that stalls: the fallback goes back to Playwright's official URLs.
    monkeypatch.setenv("PLAYWRIGHT_DOWNLOAD_HOST", "https://broken-mirror.example.test")
    monkeypatch.setenv("FAKE_PW_STALL", "all")
    assert env.run() == "fallback"
    assert not any("broken-mirror" in u for u in env.curl_urls())
    assert os.environ["PLAYWRIGHT_DOWNLOAD_HOST"] == "https://broken-mirror.example.test"


def test_cli_prints_an_actionable_error_and_exits_1(env, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_PW_STALL", "all")
    monkeypatch.setenv("FAKE_CURL_FAIL", "cdn.example.test,mirror.example.test")
    monkeypatch.setattr(helper, "playwright_cmd", lambda: env.cmd)
    monkeypatch.setattr(helper.shutil, "which", lambda name: env.curl_path)
    with pytest.raises(SystemExit) as e:
        helper.main(["install-browser"])
    assert e.value.code == 1
    err = capsys.readouterr().err
    assert "Could not install the PDF renderer" in err
    assert "backend/.env and data are unchanged" in err
    assert "run the installer again" in err
