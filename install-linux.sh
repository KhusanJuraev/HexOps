#!/usr/bin/env bash
# HexOps installer for Linux. Safe to run again: it never overwrites backend/.env,
# never drops a database, and never touches accounts, records or files.
#
#   ./install-linux.sh                          # uses backend/.env if it exists
#   ./install-linux.sh --create-database        # creates PostgreSQL role + database (sudo)
#   ./install-linux.sh --database-url URL       # use an existing, empty or HexOps database
#
# Options:
#   --database-url URL   postgresql+psycopg://user:password@127.0.0.1:5432/dbname
#                        (only used when backend/.env does not exist yet)
#   --create-database    create role "hexops" and database "hexops" with a random password
#                        via `sudo -u postgres psql` (asks first; never drops anything)
#   --api-port N         API port for a new .env (default 8000)
#   --ui-port N          UI port for a new .env (default 4173)
#   --skip-start-check   do not start HexOps briefly at the end to check it
#   --yes                do not ask before --create-database
#   --allow-root         run as root anyway (not recommended)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
ENV_FILE="$BACKEND/.env"
VENV="$BACKEND/.venv"
HELPER="$ROOT/scripts/install_helper.py"
PY_MIN="3.12"
NODE_MIN="20.19.0"

DATABASE_URL=""
CREATE_DB=0
API_PORT=8000
UI_PORT=4173
START_CHECK=1
ASSUME_YES=0
ALLOW_ROOT=0
STEP="starting"

say() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() {
  printf '\nERROR: %s\n' "$1" >&2
  shift || true
  for line in "$@"; do printf '       %s\n' "$line" >&2; done
  printf '\nHexOps was NOT installed completely (failed at: %s).\n' "$STEP" >&2
  exit 1
}
trap 'fail "unexpected error at line $LINENO while: $STEP"' ERR

while [ $# -gt 0 ]; do
  case "$1" in
    --database-url) DATABASE_URL="${2:?--database-url needs a value}"; shift 2 ;;
    --create-database) CREATE_DB=1; shift ;;
    --api-port) API_PORT="${2:?}"; shift 2 ;;
    --ui-port) UI_PORT="${2:?}"; shift 2 ;;
    --skip-start-check) START_CHECK=0; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --allow-root) ALLOW_ROOT=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) fail "unknown option: $1" "Run ./install-linux.sh --help" ;;
  esac
done

version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# --- 1. prerequisites -------------------------------------------------------------------
STEP="checking prerequisites"
say "Checking prerequisites"
if [ "$(id -u)" -eq 0 ] && [ "$ALLOW_ROOT" -eq 0 ]; then
  fail "run the installer as your normal user, not root" \
    "Files created by root cannot be changed by your user later." \
    "(If you really want root, add --allow-root.)"
fi

PYTHON=""
for candidate in python3.13 python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    v="$("$candidate" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)"
    if [ -n "$v" ] && version_ge "$v" "$PY_MIN"; then PYTHON="$(command -v "$candidate")"; break; fi
  fi
done
[ -n "$PYTHON" ] || fail "Python $PY_MIN or newer was not found" \
  "Debian/Ubuntu: sudo apt install python3 python3-venv" \
  "Fedora:        sudo dnf install python3" \
  "Then run this installer again."
"$PYTHON" -c 'import venv, ensurepip' 2>/dev/null || fail "Python's venv module is missing" \
  "Debian/Ubuntu: sudo apt install python3-venv   (or python3.12-venv)"
info "Python  $("$PYTHON" -c 'import platform; print(platform.python_version())')  ($PYTHON)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail "Node.js and npm were not found" \
    "Install Node.js $NODE_MIN or newer (LTS), e.g. Debian/Ubuntu: sudo apt install nodejs npm" \
    "or from https://nodejs.org/ — then run this installer again."
fi
NODE_V="$(node -p 'process.versions.node')"
version_ge "$NODE_V" "$NODE_MIN" || fail "Node.js $NODE_V is too old (need $NODE_MIN or newer)" \
  "Install a current LTS from https://nodejs.org/ or your distribution."
info "Node.js $NODE_V, npm $(npm --version)"

if command -v psql >/dev/null 2>&1; then
  info "PostgreSQL client $(psql --version | awk '{print $3}')"
else
  info "PostgreSQL client (psql) not found — fine if the server is reachable with the URL in .env."
fi

# --- 2. configuration (backend/.env) --------------------------------------------------------
STEP="preparing backend/.env"
say "Configuration"
random_secret() { "$PYTHON" "$HELPER" secret; }

create_database() {
  command -v sudo >/dev/null 2>&1 || fail "sudo is needed for --create-database" \
    "Create the role and database yourself (README 'Manual setup') and use --database-url."
  info "This will run PostgreSQL commands as the 'postgres' superuser (sudo -u postgres psql):"
  info "  CREATE ROLE hexops LOGIN PASSWORD <random>   — only if the role does not exist"
  info "  CREATE DATABASE hexops OWNER hexops          — only if the database does not exist"
  info "Nothing is dropped or changed otherwise. The random password is written only to backend/.env."
  if [ "$ASSUME_YES" -eq 0 ]; then
    read -r -p "    Continue? [y/N] " answer
    case "$answer" in y|Y|yes|YES) ;; *) fail "database creation cancelled" "Use --database-url with an existing database instead." ;; esac
  fi
  local role_exists db_exists password
  role_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='hexops'" 2>/dev/null)" \
    || fail "could not run psql as the postgres user" "Is PostgreSQL installed and running? (sudo systemctl status postgresql)"
  db_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hexops'")"
  if [ "$role_exists" = "1" ]; then
    fail "the PostgreSQL role 'hexops' already exists, and its password is not known to the installer" \
      "Use it with: ./install-linux.sh --database-url 'postgresql+psycopg://hexops:<password>@127.0.0.1:5432/hexops'" \
      "(nothing was changed)"
  fi
  password="$(random_secret | tr -dc 'A-Za-z0-9' | head -c 32)"
  # SQL goes through stdin, so the password never appears in the process list.
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL >/dev/null || fail "could not create the role"
CREATE ROLE hexops LOGIN PASSWORD '$password';
SQL
  if [ "$db_exists" != "1" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE hexops OWNER hexops" >/dev/null \
      || fail "could not create the database 'hexops'"
  fi
  DATABASE_URL="postgresql+psycopg://hexops:${password}@127.0.0.1:5432/hexops"
  info "Created role 'hexops' and database 'hexops'."
}

if [ -f "$ENV_FILE" ]; then
  info "backend/.env exists — keeping it unchanged."
  if [ -n "$DATABASE_URL" ] || [ "$CREATE_DB" -eq 1 ]; then
    info "(--database-url/--create-database ignored because .env exists)"
  fi
else
  if [ -z "$DATABASE_URL" ]; then
    if [ "$CREATE_DB" -eq 1 ]; then
      create_database
    else
      fail "backend/.env does not exist yet and no database was given" \
        "Either let the installer create one:   ./install-linux.sh --create-database" \
        "or use an existing database:           ./install-linux.sh --database-url 'postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/DB'"
    fi
  fi
  # .env.example + the database URL + a new random secret key; never overwrites.
  "$PYTHON" "$HELPER" make-env "$BACKEND/.env.example" "$ENV_FILE" "$DATABASE_URL" "$API_PORT" "$UI_PORT" \
    || fail "could not create backend/.env"
  info "Created backend/.env (mode 600) with a new random secret key."
fi
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
API_PORT="$(env_value HEXOPS_PORT)"; API_PORT="${API_PORT:-8000}"
UI_PORT="$(env_value HEXOPS_UI_PORT)"; UI_PORT="${UI_PORT:-4173}"

# --- 3. backend -----------------------------------------------------------------------------------
STEP="installing the backend"
say "Backend (Python virtual environment)"
if [ -x "$VENV/bin/python" ] && ! "$VENV/bin/python" -c 'import sys' >/dev/null 2>&1; then
  info "The existing virtual environment is broken (moved folder?) — recreating it."
  rm -rf "${VENV:?}"
fi
[ -x "$VENV/bin/python" ] || "$PYTHON" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -e "$BACKEND"
info "Backend packages installed."

STEP="installing the PDF renderer (Chromium)"
say "PDF renderer (Chromium, ~100 MB, once)"
"$VENV/bin/python" -m playwright install --only-shell chromium >/dev/null
if ! (cd "$BACKEND" && "$VENV/bin/python" "$HELPER" check-pdf); then
  fail "Chromium was downloaded but cannot start (often: missing system libraries)" \
    "Install them once with:  sudo $VENV/bin/python -m playwright install-deps chromium" \
    "then run this installer again."
fi
info "Chromium works (a test PDF was printed)."

# --- 4. database ----------------------------------------------------------------------------------
STEP="checking the database"
say "Database"
(cd "$BACKEND" && "$VENV/bin/python" "$HELPER" check-db) || fail "cannot connect to PostgreSQL with HEXOPS_DATABASE_URL from backend/.env" \
  "Is PostgreSQL running (sudo systemctl start postgresql)? Are the user, password and database name right?"
info "Connected."
STEP="running database migrations"
(cd "$BACKEND" && "$VENV/bin/alembic" upgrade head >/dev/null) || fail "database migration failed" \
  "Nothing was dropped. See the message above; the database user must own the database."
info "Schema is up to date ($(cd "$BACKEND" && "$VENV/bin/alembic" current 2>/dev/null | tail -1))."

# --- 5. frontend ----------------------------------------------------------------------------------
STEP="installing the frontend"
say "Frontend (npm packages and production build)"
(cd "$FRONTEND" && npm ci --no-audit --no-fund --loglevel=error >/dev/null)
(cd "$FRONTEND" && npm run -s build >/dev/null) || fail "the frontend build failed"
info "Built frontend/dist."

# --- 6. start check -----------------------------------------------------------------------------------
if [ "$START_CHECK" -eq 1 ]; then
  STEP="starting HexOps for a check"
  say "Starting HexOps briefly to check it"
  port_free() { "$PYTHON" "$HELPER" port-free "$1" 2>/dev/null; }
  port_free "$API_PORT" || fail "port $API_PORT is already in use (is HexOps already running?)" \
    "Stop it first, or skip this check with --skip-start-check."
  port_free "$UI_PORT" || fail "port $UI_PORT is already in use (is HexOps already running?)" \
    "Stop it first, or skip this check with --skip-start-check."
  LOG="$(mktemp -d)"
  (cd "$BACKEND" && exec "$VENV/bin/python" -m app) >"$LOG/api.log" 2>&1 &
  API_PID=$!
  (cd "$FRONTEND" && HEXOPS_API_URL="http://127.0.0.1:$API_PORT" exec ./node_modules/.bin/vite preview --port "$UI_PORT") >"$LOG/ui.log" 2>&1 &
  UI_PID=$!
  stop_check() {
    for pid in "$API_PID" "$UI_PID"; do pkill -TERM -P "$pid" 2>/dev/null || true; kill -TERM "$pid" 2>/dev/null || true; done
    wait "$API_PID" "$UI_PID" 2>/dev/null || true
    rm -rf "$LOG"
  }
  trap 'stop_check' EXIT
  if ! "$PYTHON" "$HELPER" wait-http "http://127.0.0.1:$API_PORT/api/health" "http://127.0.0.1:$UI_PORT/" \
      "http://127.0.0.1:$UI_PORT/api/health" --timeout 90; then
    tail -5 "$LOG/api.log" "$LOG/ui.log" >&2 || true
    fail "HexOps did not answer on http://127.0.0.1:$API_PORT (API) and http://127.0.0.1:$UI_PORT (UI, and its /api proxy)"
  fi
  SETUP="$("$PYTHON" "$HELPER" setup-status "http://127.0.0.1:$UI_PORT")"
  info "API health: OK   UI: OK   UI → API proxy: OK"
  stop_check
  trap - EXIT
fi

trap - ERR
say "HexOps is installed."
cat <<EOF

  Start it:   ./start-linux.sh          (stop with Ctrl+C)
  Open:       http://127.0.0.1:$UI_PORT

EOF
if [ "${SETUP:-}" = "required" ]; then
  echo "  First run: the page asks you to create the owner account — choose your own"
  echo "  username and password there. No account exists yet."
elif [ "${SETUP:-}" = "done" ]; then
  echo "  An account already exists: sign in with it (nothing was changed)."
fi
echo
