"""uninstall-linux.sh on throwaway installations: both modes, dry run, refusals, survivors.

Each test builds a fake HexOps folder in tmp_path with the real uninstall script and SQL,
starts processes that look like its API, UI and start script, plus decoys that must survive:
the same kind of process from another installation, a server on the HexOps port, and
unrelated processes whose working directory is inside the folder. The database tests use
disposable PostgreSQL roles and databases and run only with administrator access
(`sudo -n -u postgres psql`); they never touch the development database.
"""

import os
import secrets
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
NODE = shutil.which("node")
IS_ROOT = os.geteuid() == 0
NO_DB_ENV = "HEXOPS_SECRET_KEY=test-secret\n"
SLEEPER = "import time\nwhile True:\n    time.sleep(1)\n"


def _can_admin() -> bool:
    try:
        return (
            subprocess.run(
                ["sudo", "-n", "-u", "postgres", "psql", "-X", "-q", "-c", "select 1"],
                capture_output=True,
                timeout=10,
            ).returncode
            == 0
        )
    except (OSError, subprocess.TimeoutExpired):
        return False


def make_install(root: Path, *, real_app: bool = False, env: str | None = None) -> Path:
    """A HexOps folder: real uninstaller + SQL, stand-ins for everything else."""
    (root / "scripts" / "uninstall").mkdir(parents=True)
    shutil.copy2(REPO / "uninstall-linux.sh", root / "uninstall-linux.sh")
    for sql in (REPO / "scripts" / "uninstall").glob("*.sql"):
        shutil.copy2(sql, root / "scripts" / "uninstall" / sql.name)
    for name in ("README.md", "LICENSE", "install-linux.sh", "install-windows.ps1"):
        (root / name).write_text("hexops\n")
    (root / "start-linux.sh").write_text(
        "trap 'kill $c 2>/dev/null; exit 0' TERM\nsleep 600 & c=$!\nwait\n"
    )
    (root / "docs").mkdir()
    (root / "docs" / "DECISIONS.md").write_text("x\n")
    vite = root / "frontend" / "node_modules" / ".bin" / "vite"
    vite.parent.mkdir(parents=True)
    vite.write_text("setInterval(() => {}, 1000)\n")
    (root / "frontend" / "dist").mkdir()
    (root / "frontend" / "dist" / "index.html").write_text("<p>ui</p>\n")
    backend = root / "backend"
    backend.mkdir()
    if real_app:  # the development venv, linked: purging must remove only the link
        (backend / ".venv").symlink_to(REPO / "backend" / ".venv")
    else:
        (backend / ".venv" / "bin").mkdir(parents=True)
        (backend / ".venv" / "bin" / "python").symlink_to(Path(sys.executable))
    if real_app:
        shutil.copytree(
            REPO / "backend" / "app", backend / "app", ignore=shutil.ignore_patterns("__pycache__")
        )
    else:
        (backend / "app").mkdir()
        (backend / "app" / "__init__.py").write_text("")
        (backend / "app" / "__main__.py").write_text(SLEEPER)
    for name in ("alembic.ini", "pyproject.toml", ".env.example"):
        (backend / name).write_text("x\n")
    (backend / ".env").write_text(
        env
        or "HEXOPS_DATABASE_URL=postgresql+psycopg://no_such_role_x:pw@127.0.0.1:5432/no_such_db_x\n"
        "HEXOPS_SECRET_KEY=test-secret\nHEXOPS_PORT=8123\nHEXOPS_UI_PORT=4199\n"
    )
    (root / "data" / "uploads").mkdir(parents=True)
    (root / "data" / "uploads" / "evidence.png").write_bytes(b"\x89PNG evidence")
    (root / "data" / "backups").mkdir()
    (root / "data" / "backups" / "pre-import.hexops").write_bytes(b"backup")
    return root


class Procs:
    def __init__(self) -> None:
        self.items: dict[str, subprocess.Popen] = {}

    def start(self, name: str, args: list[str], cwd: Path) -> None:
        self.items[name] = subprocess.Popen(
            args, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

    def alive(self) -> set[str]:
        return {n for n, p in self.items.items() if p.poll() is None}

    def stop_all(self) -> None:
        for p in self.items.values():
            if p.poll() is None:
                p.send_signal(signal.SIGKILL)
                p.wait(5)


@pytest.fixture
def world(tmp_path):
    """Installation + another installation + decoys + a fake shared browser cache."""
    home = tmp_path / "home"
    cache = home / ".cache" / "ms-playwright" / "chromium_headless_shell-1"
    cache.mkdir(parents=True)
    (cache / "INSTALLATION_COMPLETE").write_text("")
    inst = make_install(tmp_path / "My HexOps")  # a space in the path on purpose
    other = make_install(tmp_path / "other-hexops")
    (inst / "my-notes.txt").write_text("mine\n")  # the user's own files: never deleted
    (inst / "backend" / "mine.txt").write_text("mine\n")

    procs = Procs()
    procs.start("api", [".venv/bin/python", "-m", "app"], inst / "backend")
    procs.start("start", ["bash", "./start-linux.sh"], inst)
    if NODE:
        procs.start("ui", [NODE, "./node_modules/.bin/vite", "preview"], inst / "frontend")
    # Decoys
    procs.start("other_api", [".venv/bin/python", "-m", "app"], other / "backend")
    procs.start(
        "port_8123",
        [sys.executable, "-m", "http.server", "8123", "--bind", "127.0.0.1"],
        tmp_path,
    )
    procs.start("sleep_in_root", ["sleep", "600"], inst)
    procs.start("python_c_in_backend", [sys.executable, "-c", SLEEPER], inst / "backend")
    procs.start("tail_readme", ["tail", "-f", str(inst / "README.md")], tmp_path)
    time.sleep(1.0)

    class World:
        pass

    w = World()
    w.tmp, w.home, w.cache, w.inst, w.other, w.procs = tmp_path, home, cache, inst, other, procs
    w.hexops = {"api", "start"} | ({"ui"} if NODE else set())
    w.decoys = {"other_api", "port_8123", "sleep_in_root", "python_c_in_backend", "tail_readme"}
    yield w
    procs.stop_all()


def run(root: Path, *args: str, stdin: str = "", home: Path | None = None, extra_env=None):
    env = {
        **os.environ,
        "HOME": str(home or root.parent / "home"),
        "LC_ALL": "C.UTF-8",
        **(extra_env or {}),
    }
    cmd = ["bash", str(root / "uninstall-linux.sh"), *args]
    if IS_ROOT:
        cmd.append("--allow-root")
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True, env=env, timeout=120)


def snapshot(root: Path) -> dict[str, bytes | str]:
    out: dict[str, bytes | str] = {}
    for p in sorted(root.rglob("*")):
        rel = str(p.relative_to(root))
        out[rel] = "link" if p.is_symlink() else ("dir" if p.is_dir() else p.read_bytes())
    return out


# --- mode choice, dry run, cancel ----------------------------------------------------------


def test_a_mode_must_be_chosen(world):
    before = snapshot(world.inst)
    res = run(world.inst)
    assert res.returncode == 1
    assert "--remove-app" in res.stderr and "--purge" in res.stderr
    assert snapshot(world.inst) == before
    assert world.procs.alive() >= world.hexops | world.decoys


def test_dry_run_lists_only_this_installation_and_changes_nothing(world):
    before = snapshot(world.inst)
    res = run(world.inst, "--remove-app", "--dry-run")
    assert res.returncode == 0, res.stderr
    out = res.stdout
    assert "Dry run: nothing was changed." in out
    assert "script start-linux.sh" in out
    assert "program backend/.venv/bin/python" in out
    if NODE:
        assert "script frontend/node_modules/.bin/vite" in out
    for decoy in world.decoys:
        assert str(world.procs.items[decoy].pid) not in out.split("Plan")[0]
    assert "Kept: " + str(world.inst / "backend" / ".env") in out
    assert str(world.inst / "my-notes.txt") in out.split("Left in place")[1]
    assert snapshot(world.inst) == before
    assert world.procs.alive() == world.hexops | world.decoys


def test_remove_app_can_be_cancelled(world):
    before = snapshot(world.inst)
    res = run(world.inst, "--remove-app", stdin="n\n")
    assert res.returncode == 1 and "cancelled; nothing was changed" in res.stderr
    assert snapshot(world.inst) == before
    assert world.procs.alive() == world.hexops | world.decoys


# --- remove the application ----------------------------------------------------------------


def test_remove_app_keeps_env_data_and_everything_unrelated(world):
    other_before = snapshot(world.other)
    res = run(world.inst, "--remove-app", "--yes")
    assert res.returncode == 0, res.stdout + res.stderr

    assert world.procs.alive() == world.decoys  # HexOps stopped, every decoy still running
    left = sorted(str(p.relative_to(world.inst)) for p in world.inst.rglob("*"))
    assert left == [
        "backend",
        "backend/.env",
        "backend/mine.txt",
        "data",
        "data/backups",
        "data/backups/pre-import.hexops",
        "data/uploads",
        "data/uploads/evidence.png",
        "my-notes.txt",
    ]
    assert (world.inst / "data/uploads/evidence.png").read_bytes() == b"\x89PNG evidence"
    assert snapshot(world.other) == other_before
    assert (world.cache / "INSTALLATION_COMPLETE").exists()
    assert "To reinstall with the same data" in res.stdout
    assert "test-secret" not in res.stdout + res.stderr

    # The uninstaller removed itself. Put a fresh copy back (as after a new download) and
    # run it again over the already-removed installation: only the copy goes.
    shutil.copy2(REPO / "uninstall-linux.sh", world.inst / "uninstall-linux.sh")
    again = run(world.inst, "--remove-app", "--yes")
    assert again.returncode == 0, again.stderr
    assert "No HexOps processes" in again.stdout
    assert not (world.inst / "uninstall-linux.sh").exists()
    assert (world.inst / "backend/.env").exists() and (world.inst / "data/uploads").exists()


def test_remove_app_on_a_partial_installation(tmp_path):
    inst = make_install(tmp_path / "hexops")
    shutil.rmtree(inst / "frontend")
    shutil.rmtree(inst / "backend" / ".venv")
    (inst / "backend" / ".env").unlink()
    res = run(inst, "--remove-app", "--yes", home=tmp_path)
    assert res.returncode == 0, res.stderr
    assert sorted(p.name for p in inst.iterdir()) == ["data"]


# --- full purge: confirmation and refusals (no database needed) ---------------------------


def test_purge_needs_the_typed_confirmation_even_with_yes(world):
    (world.inst / "backend/.env").write_text(NO_DB_ENV)
    before = snapshot(world.inst)
    for answer in ("", "yes\n", "delete hexops\n"):
        res = run(world.inst, "--purge", "--yes", stdin=answer)
        assert res.returncode == 1
        assert "not confirmed; nothing was changed" in res.stderr
        assert snapshot(world.inst) == before
    assert world.procs.alive() == world.hexops | world.decoys


def test_purge_refuses_a_database_on_another_computer(world):
    (world.inst / "backend/.env").write_text(
        "HEXOPS_DATABASE_URL=postgresql+psycopg://hexops:pw@db.example.org:5432/hexops\n"
    )
    before = snapshot(world.inst)
    res = run(world.inst, "--purge", stdin="DELETE HEXOPS\n")
    assert res.returncode == 1
    assert "on another computer (db.example.org)" in res.stderr
    assert "pw@" not in res.stdout + res.stderr
    assert snapshot(world.inst) == before
    assert world.procs.alive() == world.hexops | world.decoys


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("postgresql+psycopg://postgres:pw@127.0.0.1:5432/hexops", "not a dedicated HexOps role"),
        ("postgresql+psycopg://hexops:pw@127.0.0.1:5432/postgres", "system database"),
    ],
)
def test_purge_refuses_system_roles_and_databases(world, url, message):
    (world.inst / "backend/.env").write_text(f"HEXOPS_DATABASE_URL={url}\n")
    before = snapshot(world.inst)
    res = run(world.inst, "--purge", stdin="DELETE HEXOPS\n")
    assert res.returncode == 1 and message in res.stderr
    assert snapshot(world.inst) == before


def test_export_must_go_outside_the_folder(world):
    before = snapshot(world.inst)
    res = run(world.inst, "--purge", "--export", str(world.inst / "data" / "x.hexops"))
    assert res.returncode == 1 and "outside" in res.stderr
    assert snapshot(world.inst) == before


def test_purge_without_a_known_database_removes_the_folder(world):
    (world.inst / "backend/.env").write_text(NO_DB_ENV)
    (world.inst / "my-notes.txt").unlink()
    (world.inst / "backend/mine.txt").unlink()
    target = world.tmp / "elsewhere"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    (world.inst / "data" / "linked").symlink_to(target)

    res = run(world.inst, "--purge", stdin="DELETE HEXOPS\n")
    assert res.returncode == 0, res.stdout + res.stderr
    assert "no HEXOPS_DATABASE_URL" in res.stdout
    assert not world.inst.exists()
    assert (target / "keep.txt").read_text() == "keep"  # only the link went
    assert world.procs.alive() == world.decoys
    assert (world.cache / "INSTALLATION_COMPLETE").exists()
    assert world.other.exists()


def test_purge_keeps_files_that_are_not_hexops(world):
    (world.inst / "backend/.env").write_text(NO_DB_ENV)
    res = run(world.inst, "--purge", stdin="DELETE HEXOPS\n")
    assert res.returncode == 0, res.stderr
    left = sorted(str(p.relative_to(world.inst)) for p in world.inst.rglob("*"))
    assert left == ["backend", "backend/mine.txt", "my-notes.txt"]


# --- full purge with a real (disposable) PostgreSQL database ------------------------------

needs_admin = pytest.mark.skipif(
    not (IS_ROOT and _can_admin()), reason="needs root with `sudo -u postgres psql`"
)


def admin_sql(sql: str, db: str = "postgres") -> str:
    res = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
         "-d", db],
        input=sql, capture_output=True, text=True, check=True,
    )  # fmt: skip
    return res.stdout.strip()


@pytest.fixture
def pg():
    """A dedicated role + database migrated to HexOps' schema, and an unrelated pair."""
    tag = secrets.token_hex(4)
    role, db = f"hexops_un_{tag}", f"hexops_un_{tag}"
    other_role, other_db = f"otherapp_{tag}", f"otherapp_{tag}"
    password = secrets.token_hex(16)
    admin_sql(f"CREATE ROLE {role} LOGIN PASSWORD '{password}'; CREATE ROLE {other_role} LOGIN;")
    admin_sql(f"CREATE DATABASE {db} OWNER {role}")
    admin_sql(f"CREATE DATABASE {other_db} OWNER {other_role}")
    url = f"postgresql+psycopg://{role}:{password}@127.0.0.1:5432/{db}"
    subprocess.run(
        [str(REPO / "backend/.venv/bin/alembic"), "upgrade", "head"],
        cwd=REPO / "backend",
        env={**os.environ, "HEXOPS_DATABASE_URL": url},
        check=True,
        capture_output=True,
    )

    class PG:
        pass

    p = PG()
    p.role, p.db, p.other_role, p.other_db, p.url, p.password = (
        role, db, other_role, other_db, url, password
    )  # fmt: skip
    p.env = (
        f"HEXOPS_DATABASE_URL={url}\nHEXOPS_SECRET_KEY=test-secret-{tag}-{secrets.token_hex(16)}\n"
    )
    yield p
    for name in (db, other_db):
        admin_sql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
    admin_sql(f"DROP ROLE IF EXISTS {role}; DROP ROLE IF EXISTS {other_role};")


def exists(kind: str, name: str) -> bool:
    table, col = ("pg_database", "datname") if kind == "db" else ("pg_roles", "rolname")
    return admin_sql(f"SELECT count(*) FROM {table} WHERE {col} = '{name}'") == "1"


@needs_admin
def test_purge_drops_only_its_own_database_and_role_after_an_export(tmp_path, pg):
    inst = make_install(tmp_path / "hexops", real_app=True, env=pg.env)
    export = tmp_path / "saved" / "before-purge.hexops"
    export.parent.mkdir()
    passphrase = "a long export passphrase"

    dry = run(inst, "--purge", "--dry-run", home=tmp_path)
    assert dry.returncode == 0, dry.stderr
    assert f'DROP DATABASE "{pg.db}"' in dry.stdout and f'DROP ROLE "{pg.role}"' in dry.stdout
    assert exists("db", pg.db) and inst.exists()

    res = run(
        inst,
        "--purge",
        "--export",
        str(export),
        stdin=f"DELETE HEXOPS\n{passphrase}\n{passphrase}\n",
        home=tmp_path,
    )
    out = res.stdout + res.stderr
    assert res.returncode == 0, out
    for secret in (pg.password, "test-secret", passphrase):
        assert secret not in out
    assert export.exists() and export.stat().st_mode & 0o777 == 0o600
    assert not exists("db", pg.db) and not exists("role", pg.role)
    assert exists("db", pg.other_db) and exists("role", pg.other_role)
    assert exists("db", "hexops") and exists("role", "hexops")  # the development database
    assert not inst.exists()
    assert (REPO / "backend/.venv/bin/python").exists()  # the linked venv itself survives


@needs_admin
@pytest.mark.parametrize("case", ["owns_other_db", "foreign_table", "connected"])
def test_purge_refuses_a_database_or_role_used_by_something_else(tmp_path, pg, case):
    inst = make_install(tmp_path / "hexops", env=pg.env)
    holder = None
    if case == "owns_other_db":
        admin_sql(f"ALTER DATABASE {pg.other_db} OWNER TO {pg.role}")
        expected = f"also owns database(s): {pg.other_db}"
    elif case == "foreign_table":
        admin_sql("CREATE TABLE invoices (id int)", db=pg.db)
        expected = "tables HexOps did not create: public.invoices"
    else:
        holder = subprocess.Popen(
            [
                "sudo",
                "-u",
                "postgres",
                "psql",
                "-X",
                "-q",
                "-d",
                pg.db,
                "-c",
                "select pg_sleep(60)",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(1.5)
        expected = "not this HexOps installation is connected"
    before = snapshot(inst)
    try:
        res = run(inst, "--purge", stdin="DELETE HEXOPS\n", home=tmp_path)
    finally:
        if holder:
            holder.kill()
            holder.wait(10)
    assert res.returncode == 1
    assert expected in res.stderr and "Nothing was changed" in res.stderr
    assert snapshot(inst) == before
    assert exists("db", pg.db) and exists("role", pg.role)
