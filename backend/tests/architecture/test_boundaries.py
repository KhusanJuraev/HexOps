"""Modular-monolith rules, checked statically (see docs/ADDING_A_MODULE.md).

- app/core never imports a module.
- A module imports another module only through that module's public.py.
- Every module with a router.py is registered in app.main.ROUTERS.
"""

import ast
from pathlib import Path

from app.main import ROUTERS

APP = Path(__file__).resolve().parents[2] / "app"
MODULES = sorted(p.name for p in (APP / "modules").iterdir() if (p / "__init__.py").exists())


def _imports(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(), filename=str(path))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            # "from app.modules.x import public" imports app.modules.x.public
            out.extend((node.lineno, f"{node.module}.{alias.name}") for alias in node.names)
        elif isinstance(node, ast.Import):
            out.extend((node.lineno, alias.name) for alias in node.names)
    return out


def test_core_does_not_import_modules():
    bad = [
        f"{path.relative_to(APP)}:{line} imports {name}"
        for path in (APP / "core").rglob("*.py")
        for line, name in _imports(path)
        if name.startswith("app.modules")
    ]
    assert bad == []


def test_modules_use_only_each_others_public_interface():
    bad = []
    for module in MODULES:
        for path in (APP / "modules" / module).rglob("*.py"):
            for line, name in _imports(path):
                parts = name.split(".")
                if parts[:2] != ["app", "modules"] or len(parts) < 3 or parts[2] == module:
                    continue
                if parts[3:4] != ["public"]:
                    bad.append(f"{path.relative_to(APP)}:{line} imports {name}")
    assert bad == [], "import other modules via app.modules.<name>.public only"


def test_every_module_router_is_registered():
    def owner(router) -> str:  # app.modules.<name>.router -> <name>
        return router.routes[0].endpoint.__module__.split(".")[2]

    with_router = {m for m in MODULES if (APP / "modules" / m / "router.py").exists()}
    assert with_router - {owner(r) for r in ROUTERS} == set(), "add missing routers to ROUTERS"
