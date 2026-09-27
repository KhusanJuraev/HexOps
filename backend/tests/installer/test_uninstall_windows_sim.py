"""uninstall-windows.ps1 run end to end by PowerShell 7 on Linux: a simulation, not Windows.

Get-CimInstance and taskkill do not exist on Linux, so thin stand-ins built on Get-Process /
Stop-Process are defined before the script runs; everything else is the real script: mode
choice, dry run, the typed confirmation, database refusals and drops, and file removal.
Needs pwsh (HEXOPS_PWSH or PATH); skipped otherwise. What this cannot show: Windows' own
process list, junctions, file locking, and PowerShell 5.1 itself.
"""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tests.installer.test_uninstall_linux import IS_ROOT, NO_DB_ENV, Procs, admin_sql, exists
from tests.installer.test_uninstall_linux import needs_admin as needs_admin  # noqa: PLC0414
from tests.installer.test_uninstall_linux import pg as pg  # noqa: F401,PLC0414 - fixture

REPO = Path(__file__).resolve().parents[3]
PWSH = os.environ.get("HEXOPS_PWSH") or shutil.which("pwsh")
NODE = shutil.which("node")
SLEEP = shutil.which("sleep")

pytestmark = pytest.mark.skipif(not (PWSH and NODE and SLEEP), reason="needs pwsh and node")

PRELUDE = r"""
function global:Get-CimInstance {
  Get-Process | ForEach-Object {
    $parent = 0; if ($_.Parent) { $parent = $_.Parent.Id }
    [pscustomobject]@{ ProcessId = $_.Id; ParentProcessId = $parent; Name = $_.ProcessName;
      ExecutablePath = $_.Path; CommandLine = $_.CommandLine }
  }
}
function global:taskkill {
  $id = [int]$args[[array]::IndexOf($args, '/PID') + 1]
  Get-Process | Where-Object { $_.Parent -and $_.Parent.Id -eq $id } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
"""


def make_windows_install(root: Path, env: str = NO_DB_ENV) -> Path:
    (root / "scripts" / "uninstall").mkdir(parents=True)
    shutil.copy2(REPO / "uninstall-windows.ps1", root / "uninstall-windows.ps1")
    for sql in (REPO / "scripts" / "uninstall").glob("*.sql"):
        shutil.copy2(sql, root / "scripts" / "uninstall" / sql.name)
    for name in ("README.md", "LICENSE", "install-windows.ps1", "start-windows.ps1"):
        (root / name).write_text("hexops\n")
    vite = root / "frontend" / "node_modules" / "vite" / "bin" / "vite.js"
    vite.parent.mkdir(parents=True)
    vite.write_text("setInterval(() => {}, 1000)\n")
    scripts = root / "backend" / ".venv" / "Scripts"
    scripts.mkdir(parents=True)
    shutil.copy2(SLEEP, scripts / "python.exe")  # a program that lives in this folder
    (root / "backend" / "app").mkdir()
    (root / "backend" / "alembic.ini").write_text("x\n")
    (root / "backend" / ".env").write_text(env)
    (root / "data" / "uploads").mkdir(parents=True)
    (root / "data" / "uploads" / "evidence.png").write_bytes(b"evidence")
    return root


def run_ps(root: Path, *args: str, stdin: str = "", env_extra=None):
    command = PRELUDE + f"& '{root / 'uninstall-windows.ps1'}' " + " ".join(args)
    env = {**os.environ, **(env_extra or {})}
    env.pop("PGPASSWORD", None) if not env_extra or "PGPASSWORD" not in env_extra else None
    return subprocess.run(
        [PWSH, "-NoProfile", "-Command", command],
        input=stdin,
        capture_output=True,
        text=True,
        cwd=root.parent,
        env=env,
        timeout=180,
    )


@pytest.fixture
def world(tmp_path):
    inst = make_windows_install(tmp_path / "HexOps")
    other = make_windows_install(tmp_path / "HexOps-old")  # same name prefix on purpose
    (inst / "my-notes.txt").write_text("mine\n")
    procs = Procs()
    procs.start("api", [str(inst / "backend/.venv/Scripts/python.exe"), "600"], inst / "backend")
    procs.start("ui", [NODE, str(inst / "frontend/node_modules/vite/bin/vite.js")], tmp_path)
    procs.start("other_api", [str(other / "backend/.venv/Scripts/python.exe"), "600"], tmp_path)
    procs.start("other_ui", [NODE, str(other / "frontend/node_modules/vite/bin/vite.js")], tmp_path)
    procs.start(
        "port_4173", [sys.executable, "-m", "http.server", "4173", "--bind", "127.0.0.1"], tmp_path
    )
    procs.start("sleep_in_root", ["sleep", "600"], inst)
    time.sleep(1.0)

    class W:
        pass

    w = W()
    w.tmp, w.inst, w.other, w.procs = tmp_path, inst, other, procs
    w.hexops = {"api", "ui"}
    w.decoys = {"other_api", "other_ui", "port_4173", "sleep_in_root"}
    yield w
    procs.stop_all()


def tree(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root)) for p in root.rglob("*"))


def test_sim_a_mode_must_be_chosen(world):
    before = tree(world.inst)
    res = run_ps(world.inst)
    assert res.returncode == 1 and "-RemoveApp" in res.stdout
    assert tree(world.inst) == before


def test_sim_dry_run_changes_nothing(world):
    before = tree(world.inst)
    res = run_ps(world.inst, "-RemoveApp", "-DryRun")
    assert res.returncode == 0, res.stdout + res.stderr
    assert "Dry run: nothing was changed." in res.stdout
    assert f"pid {world.procs.items['api'].pid}: program" in res.stdout
    assert f"pid {world.procs.items['ui'].pid}: node (vite)" in res.stdout
    for d in world.decoys:
        assert f"pid {world.procs.items[d].pid}:" not in res.stdout
    assert tree(world.inst) == before
    assert world.procs.alive() == world.hexops | world.decoys


def test_sim_remove_app_keeps_data_and_unrelated_processes(world):
    other_before = tree(world.other)
    res = run_ps(world.inst, "-RemoveApp", "-Yes")
    assert res.returncode == 0, res.stdout + res.stderr
    assert world.procs.alive() == world.decoys
    assert tree(world.inst) == [
        "backend",
        "backend/.env",
        "data",
        "data/uploads",
        "data/uploads/evidence.png",
        "my-notes.txt",
    ]
    assert tree(world.other) == other_before
    assert "To reinstall with the same data" in res.stdout


def test_sim_purge_needs_the_typed_confirmation(world):
    before = tree(world.inst)
    for answer in ("\n", "yes\n", "delete hexops\n"):
        res = run_ps(world.inst, "-Purge", "-Yes", stdin=answer)
        assert res.returncode == 1 and "not confirmed; nothing was changed" in res.stdout
    assert tree(world.inst) == before
    assert world.procs.alive() == world.hexops | world.decoys


def test_sim_purge_refuses_a_remote_database(world):
    (world.inst / "backend/.env").write_text(
        "HEXOPS_DATABASE_URL=postgresql+psycopg://hexops:pw@db.example.org:5432/hexops\n"
    )
    before = tree(world.inst)
    res = run_ps(world.inst, "-Purge", stdin="DELETE HEXOPS\n")
    assert res.returncode == 1 and "on another computer (db.example.org)" in res.stdout
    assert tree(world.inst) == before


def test_sim_purge_without_a_database_removes_the_folder(world):
    (world.inst / "my-notes.txt").unlink()
    res = run_ps(world.inst, "-Purge", stdin="DELETE HEXOPS\n")
    assert res.returncode == 0, res.stdout + res.stderr
    assert not world.inst.exists()
    assert world.procs.alive() == world.decoys
    assert world.other.exists()


@needs_admin
def test_sim_purge_drops_its_database_and_role(tmp_path, pg):  # noqa: F811
    inst = make_windows_install(tmp_path / "HexOps", env=pg.env)
    admin, password = f"pgadmin_{pg.db[-8:]}", os.urandom(12).hex()
    admin_sql(f"CREATE ROLE {admin} LOGIN SUPERUSER PASSWORD '{password}'")
    try:
        env = {"PGPASSWORD": password}
        res = run_ps(inst, "-Purge", "-PostgresUser", admin, stdin="DELETE HEXOPS\n", env_extra=env)
        out = res.stdout + res.stderr
        assert res.returncode == 0, out
        assert password not in out and pg.password not in out
        assert not exists("db", pg.db) and not exists("role", pg.role)
        assert exists("db", pg.other_db) and exists("db", "hexops")
        assert not inst.exists()
    finally:
        admin_sql(f"DROP ROLE IF EXISTS {admin}")


@needs_admin
def test_sim_purge_refuses_a_role_that_owns_another_database(tmp_path, pg):  # noqa: F811
    inst = make_windows_install(tmp_path / "HexOps", env=pg.env)
    admin_sql(f"ALTER DATABASE {pg.other_db} OWNER TO {pg.role}")
    admin, password = f"pgadmin_{pg.db[-8:]}", os.urandom(12).hex()
    admin_sql(f"CREATE ROLE {admin} LOGIN SUPERUSER PASSWORD '{password}'")
    try:
        before = tree(inst)
        res = run_ps(
            inst,
            "-Purge",
            "-PostgresUser",
            admin,
            stdin="DELETE HEXOPS\n",
            env_extra={"PGPASSWORD": password},
        )
        assert res.returncode == 1
        assert f"also owns database(s): {pg.other_db}" in res.stdout
        assert tree(inst) == before and exists("db", pg.db) and exists("role", pg.role)
    finally:
        admin_sql(f"DROP ROLE IF EXISTS {admin}")


def test_sim_is_not_run_as_root_only(world):
    # Sanity: these simulations use the current user's processes only.
    assert IS_ROOT == (os.geteuid() == 0)
