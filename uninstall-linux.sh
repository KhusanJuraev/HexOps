#!/usr/bin/env bash
# Uninstall HexOps from this folder. Choose one mode explicitly:
#
#   ./uninstall-linux.sh --remove-app     # remove the application; KEEP the database,
#                                         # backend/.env and data/ (reinstall any time)
#   ./uninstall-linux.sh --purge          # remove EVERYTHING: application, the HexOps
#                                         # PostgreSQL database and role, backend/.env, data/
#
# Options:
#   --dry-run          show what would be stopped and deleted; change nothing
#   --export FILE      first save an encrypted .hexops export of all records and evidence
#                      to FILE (outside this folder; asks for a passphrase)
#   --yes              do not ask before --remove-app (--purge ALWAYS asks you to type
#                      DELETE HEXOPS)
#   --allow-root       run as root anyway (not recommended)
#
# Never touched: Python, Node.js, PostgreSQL itself, other databases and roles, browsers,
# and the shared Playwright cache (~/.cache/ms-playwright). Only processes that belong to
# this folder are stopped (never "whatever uses port 8000"). A database on another
# computer, or a database/role that anything else uses, is refused.
# PostgreSQL administration uses `sudo -u postgres psql`; set HEXOPS_PG_ADMIN to another
# command (for example "psql -h 127.0.0.1 -U postgres") if your server needs that.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_PHYS="$(cd "$ROOT" && pwd -P)"
BACKEND="$ROOT/backend"
ENV_FILE="$BACKEND/.env"
SQL_DIR="$ROOT/scripts/uninstall"
CONFIRM_WORD="DELETE HEXOPS"

# What the application consists of. Anything else in this folder is left in place.
APP_TOP=(frontend docs scripts .git .github .gitignore .gitattributes LICENSE README.md
  THIRD_PARTY_NOTICES.md install-linux.sh install-windows.ps1 start-linux.sh
  start-windows.ps1 uninstall-linux.sh uninstall-windows.ps1)
APP_BACKEND=(app alembic alembic.ini tests pyproject.toml .env.example .venv .pytest_cache
  .ruff_cache __pycache__)

MODE=""
DRY_RUN=0
ASSUME_YES=0
ALLOW_ROOT=0
EXPORT=""

say() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() {
  printf '\nERROR: %s\n' "$1" >&2
  shift || true
  for line in "$@"; do printf '       %s\n' "$line" >&2; done
  exit 1
}

inside_root() {  # is the (normalised, not symlink-resolved) path inside this folder?
  local p="$1"
  case "$p" in "$ROOT"/*|"$ROOT_PHYS"/*) return 0 ;; esac
  return 1
}

# --- processes -------------------------------------------------------------------------------

ancestors() {  # this script and every process above it: never stopped
  local pid=$$
  while [ -n "$pid" ] && [ "$pid" != 0 ]; do
    printf '%s\n' "$pid"
    pid="$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  done
}

is_descendant() {  # is $1 started (directly or not) by this script?
  local pid="$1"
  while [ -n "$pid" ] && [ "$pid" != 0 ] && [ "$pid" != 1 ]; do
    [ "$pid" = "$$" ] && return 0
    pid="$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  done
  return 1
}

# A process belongs to this installation only if its program lies inside this folder:
# its executable, its argv[0] (e.g. backend/.venv/bin/python), or - for node/python/sh -
# the script it runs (frontend/node_modules/.bin/vite, start-linux.sh). Ports are never used.
process_kind() {
  local pid="$1" cwd exe arg0 arg1 base resolved
  local -a argv=()
  mapfile -d '' -t argv < "/proc/$pid/cmdline" 2>/dev/null || return 1
  [ "${#argv[@]}" -gt 0 ] || return 1
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
  exe="${exe% (deleted)}"
  resolve() {
    case "$1" in
      /*) realpath -m -s -- "$1" ;;
      */*) [ -n "$cwd" ] && realpath -m -s -- "$cwd/$1" ;;
      *) return 1 ;;
    esac
  }
  arg0="${argv[0]}"
  if [ -n "$exe" ] && inside_root "$exe"; then printf 'program %s\n' "${exe#"$ROOT_PHYS"/}"; return 0; fi
  if resolved="$(resolve "$arg0")" && inside_root "$resolved"; then
    printf 'program %s\n' "${resolved#"$ROOT"/}"; return 0
  fi
  base="${arg0##*/}"
  if [[ "$base" =~ ^(node|nodejs|bash|sh|dash|python[0-9.]*)$ ]] && [ "${#argv[@]}" -gt 1 ]; then
    arg1="${argv[1]}"
    if resolved="$(resolve "$arg1")" && inside_root "$resolved"; then
      printf 'script %s\n' "${resolved#"$ROOT"/}"; return 0
    fi
  fi
  return 1
}

find_processes() {  # "pid<TAB>user<TAB>what" for every process of this installation
  local d pid kind skip
  skip=" $(ancestors | tr '\n' ' ') "
  for d in /proc/[0-9]*; do
    pid="${d#/proc/}"
    [[ "$skip" == *" $pid "* ]] && continue
    kind="$(process_kind "$pid")" || continue
    is_descendant "$pid" && continue  # this script's own subshells
    printf '%s\t%s\t%s\n' "$pid" "$(stat -c %U "$d" 2>/dev/null || echo '?')" "$kind"
  done
}

stop_processes() {
  local -a pids=()
  local line pid user what
  while IFS=$'\t' read -r pid user what; do
    [ -n "$pid" ] || continue
    pids+=("$pid")
  done <<< "$PROCS"
  [ "${#pids[@]}" -gt 0 ] || return 0
  # start-linux.sh first: its own trap stops the API and the UI cleanly.
  for pid in "${pids[@]}"; do
    if [[ "$(process_kind "$pid" 2>/dev/null)" == *start-linux.sh* ]]; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  sleep 1
  for pid in "${pids[@]}"; do
    if process_kind "$pid" >/dev/null 2>&1; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  for _ in $(seq 1 20); do
    local alive=0
    for pid in "${pids[@]}"; do process_kind "$pid" >/dev/null 2>&1 && alive=1; done
    [ "$alive" -eq 0 ] && break
    sleep 0.5
  done
  for pid in "${pids[@]}"; do  # still there after 10 s: same process (checked again), KILL
    if process_kind "$pid" >/dev/null 2>&1; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  sleep 0.5
  for pid in "${pids[@]}"; do
    process_kind "$pid" >/dev/null 2>&1 && fail "process $pid of this installation could not be stopped"
  done
  info "Stopped ${#pids[@]} HexOps process(es)."
}

# --- database ------------------------------------------------------------------------------

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -1; }

# Sets DB_USER DB_HOST DB_PORT DB_NAME from HEXOPS_DATABASE_URL. The password is not read.
parse_database_url() {
  local url parts
  url="$(env_value HEXOPS_DATABASE_URL)"
  [ -n "$url" ] || return 1
  parts="$(HEXOPS_URL="$url" python3 - <<'EOF'
import os, sys, urllib.parse
u = urllib.parse.urlsplit(os.environ["HEXOPS_URL"].strip().strip("'\""))
if not u.scheme.startswith("postgresql") or not u.username or not u.path.strip("/"):
    sys.exit(1)
print(urllib.parse.unquote(u.username))
print(u.hostname or "")
print(u.port or 5432)
print(urllib.parse.unquote(u.path.lstrip("/")))
EOF
)" || fail "HEXOPS_DATABASE_URL in backend/.env cannot be read; nothing was changed."
  mapfile -t DB_FIELDS <<< "$parts"
  DB_USER="${DB_FIELDS[0]}"; DB_HOST="${DB_FIELDS[1]}"; DB_PORT="${DB_FIELDS[2]}"; DB_NAME="${DB_FIELDS[3]}"
}

admin_psql() {  # admin_psql <database> [psql args...] (SQL on stdin)
  local db="$1"; shift
  local -a admin
  read -r -a admin <<< "${HEXOPS_PG_ADMIN:-sudo -u postgres psql}"
  "${admin[@]}" -X -q -p "$DB_PORT" -d "$db" "$@"
}

kv() { printf '%s\n' "$CHECKS" | sed -n "s/^$1=//p" | tail -1; }

# Decides DROP_DB / DROP_ROLE, or refuses (exit) before anything is changed.
check_database() {
  DROP_DB=no; DROP_ROLE=no; DB_NOTE=""
  if [ ! -f "$ENV_FILE" ]; then DB_NOTE="backend/.env not found: no database is known to this installation."; return; fi
  if ! parse_database_url; then DB_NOTE="backend/.env has no HEXOPS_DATABASE_URL: no database to drop."; return; fi
  case "$DB_HOST" in
    127.0.0.1|localhost|::1|"") ;;
    *) fail "the database is on another computer ($DB_HOST); --purge only removes a database on this computer." \
         "Nothing was changed. Remove the application with --remove-app and delete that database yourself." ;;
  esac
  case "$DB_NAME" in postgres|template0|template1) fail "refusing to drop the system database '$DB_NAME'." ;; esac
  if [ "$DB_USER" = postgres ] || [[ "$DB_USER" == pg_* ]]; then
    fail "HexOps connects as the PostgreSQL role '$DB_USER', which is not a dedicated HexOps role; nothing was changed."
  fi
  command -v "$(read -r -a a <<< "${HEXOPS_PG_ADMIN:-sudo -u postgres psql}"; echo "${a[0]}")" >/dev/null 2>&1 \
    || fail "cannot run PostgreSQL administration (${HEXOPS_PG_ADMIN:-sudo -u postgres psql}); nothing was changed."
  CHECKS="$(admin_psql postgres -v db="$DB_NAME" -v role="$DB_USER" < "$SQL_DIR/cluster_check.sql")" \
    || fail "cannot check the database as the PostgreSQL administrator; nothing was changed." \
            "Is PostgreSQL running on port $DB_PORT? (sudo -u postgres psql must work, or set HEXOPS_PG_ADMIN)"
  local refuse=()
  if [ "$(kv db_exists)" = 1 ]; then
    [ "$(kv db_owner)" = "$DB_USER" ] || refuse+=("database '$DB_NAME' belongs to role '$(kv db_owner)', not to '$DB_USER'")
    local schema foreign ext alembic tables
    schema="$(admin_psql "$DB_NAME" < "$SQL_DIR/schema_check.sql")" \
      || fail "cannot inspect database '$DB_NAME'; nothing was changed."
    CHECKS="$CHECKS"$'\n'"$schema"
    foreign="$(kv foreign_tables)"; ext="$(kv foreign_extensions)"; alembic="$(kv alembic)"; tables="$(kv tables)"
    [ -z "$foreign" ] || refuse+=("database '$DB_NAME' contains tables HexOps did not create: $foreign")
    [ -z "$ext" ] || refuse+=("database '$DB_NAME' uses extensions HexOps does not: $ext")
    if [ -z "$alembic" ] && [ "${tables:-0}" != 0 ]; then refuse+=("database '$DB_NAME' has tables but no HexOps schema version"); fi
    DROP_DB=yes
  fi
  if [ "$(kv role_exists)" = 1 ]; then
    [ "$(kv role_privileged)" = 0 ] || refuse+=("role '$DB_USER' has administrator powers (superuser/createdb/createrole/...)")
    [ -z "$(kv other_dbs_owned)" ] || refuse+=("role '$DB_USER' also owns database(s): $(kv other_dbs_owned)")
    [ -z "$(kv deps_elsewhere)" ] || refuse+=("role '$DB_USER' owns or may use objects in: $(kv deps_elsewhere)")
    [ "$(kv memberships)" = 0 ] || refuse+=("role '$DB_USER' is a member of, or has members in, other roles")
    [ "$(kv sessions_elsewhere)" = 0 ] || refuse+=("role '$DB_USER' is connected to another database right now")
    DROP_ROLE=yes
  fi
  if [ "$(kv sessions_db)" != 0 ] && [ -z "$PROCS" ]; then
    refuse+=("something that is not this HexOps installation is connected to '$DB_NAME'")
  fi
  if [ "${#refuse[@]}" -gt 0 ]; then
    fail "the database and role are not only used by this HexOps installation:" "${refuse[@]}" \
      "Nothing was changed. Use --remove-app instead, and clean up PostgreSQL yourself."
  fi
  if [ "$DROP_DB" = no ] && [ "$DROP_ROLE" = no ]; then DB_NOTE="database '$DB_NAME' and role '$DB_USER' do not exist (already removed)."; fi
}

# --- files ---------------------------------------------------------------------------------

collect_files() {  # fills DELETE (paths) and LEFT (unknown entries kept)
  DELETE=(); LEFT=()
  local name path
  for name in "${APP_TOP[@]}"; do [ -e "$ROOT/$name" ] || [ -L "$ROOT/$name" ] && DELETE+=("$ROOT/$name"); done
  if [ -d "$BACKEND" ]; then
    for name in "${APP_BACKEND[@]}"; do [ -e "$BACKEND/$name" ] || [ -L "$BACKEND/$name" ] && DELETE+=("$BACKEND/$name"); done
    for path in "$BACKEND"/*.egg-info; do [ -e "$path" ] && DELETE+=("$path"); done
  fi
  if [ "$MODE" = purge ]; then
    [ -e "$ENV_FILE" ] && DELETE+=("$ENV_FILE")
    { [ -e "$ROOT/data" ] || [ -L "$ROOT/data" ]; } && DELETE+=("$ROOT/data")
  fi
  local keep=" ${APP_TOP[*]} backend data "
  for path in "$ROOT"/* "$ROOT"/.[!.]* "$ROOT"/..?*; do
    { [ -e "$path" ] || [ -L "$path" ]; } || continue
    name="${path##*/}"
    [[ "$keep" == *" $name "* ]] || LEFT+=("$path")
  done
  if [ -d "$BACKEND" ]; then
    keep=" ${APP_BACKEND[*]} .env "
    for path in "$BACKEND"/* "$BACKEND"/.[!.]* "$BACKEND"/..?*; do
      { [ -e "$path" ] || [ -L "$path" ]; } || continue
      name="${path##*/}"
      [[ "$keep" == *" $name "* ]] || [[ "$name" == *.egg-info ]] || LEFT+=("$path")
    done
  fi
}

describe() {
  local p="$1"
  if [ -L "$p" ]; then printf '%s  (symbolic link: only the link is removed)' "$p"
  elif [ -d "$p" ]; then printf '%s/  (%s)' "$p" "$(du -sh -- "$p" 2>/dev/null | cut -f1)"
  else printf '%s' "$p"; fi
}

configured_outside() {  # data folders that backend/.env moved outside this folder
  local var dir
  for var in HEXOPS_UPLOADS_DIR HEXOPS_PDF_DIR HEXOPS_TRANSFER_DIR HEXOPS_BACKUPS_DIR; do
    dir="$(env_value "$var")"
    [ -n "$dir" ] || continue
    case "$dir" in /*) ;; *) dir="$BACKEND/$dir" ;; esac
    dir="$(realpath -m -s -- "$dir")"
    inside_root "$dir" || printf '%s=%s\n' "$var" "$dir"
  done
}

# --- main ----------------------------------------------------------------------------------

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --remove-app) [ -z "$MODE" ] || fail "choose either --remove-app or --purge"; MODE=app; shift ;;
      --purge) [ -z "$MODE" ] || fail "choose either --remove-app or --purge"; MODE=purge; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --yes) ASSUME_YES=1; shift ;;
      --export) EXPORT="${2:?--export needs a file name}"; shift 2 ;;
      --allow-root) ALLOW_ROOT=1; shift ;;
      -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
      *) fail "unknown option: $1" "Run ./uninstall-linux.sh --help" ;;
    esac
  done
  [ -n "$MODE" ] || fail "choose what to do: --remove-app (keep your data) or --purge (delete everything)" \
    "Add --dry-run to see the plan first. Run ./uninstall-linux.sh --help for details."
  if [ "$(id -u)" -eq 0 ] && [ "$ALLOW_ROOT" -eq 0 ]; then
    fail "run this as the user who installed HexOps, not root (or add --allow-root)."
  fi
  # Refuse to work on anything that does not look like a HexOps folder.
  case "$ROOT_PHYS" in /|"$HOME"|"$(cd "$HOME" && pwd -P)") fail "refusing to uninstall from $ROOT" ;; esac
  if [ ! -f "$ROOT/uninstall-linux.sh" ] || { [ ! -d "$BACKEND" ] && [ ! -d "$ROOT/frontend" ] && [ ! -d "$ROOT/data" ]; }; then
    fail "$ROOT does not look like a HexOps folder."
  fi

  local export_abs=""
  if [ -n "$EXPORT" ]; then
    export_abs="$(realpath -m -- "$EXPORT")"
    if inside_root "$export_abs" || inside_root "$(realpath -m -s -- "$EXPORT")"; then
      fail "the export must be saved outside $ROOT, which is being removed."
    fi
    [ -d "$(dirname "$export_abs")" ] || fail "the folder for the export does not exist: $(dirname "$export_abs")"
    [ ! -e "$export_abs" ] || fail "$export_abs already exists; choose a new file name."
    if [ ! -x "$BACKEND/.venv/bin/python" ] || [ ! -f "$ENV_FILE" ] || [ ! -d "$BACKEND/app" ]; then
      fail "an export needs the installed application (backend/.venv, backend/app, backend/.env)." \
           "Run ./install-linux.sh first, or export from Settings → Data, or uninstall without --export."
    fi
  fi

  say "HexOps in $ROOT"
  PROCS="$(find_processes)"
  if [ -n "$PROCS" ]; then
    local me; me="$(id -un)"
    info "Processes of this installation (will be stopped):"
    while IFS=$'\t' read -r pid user what; do info "  pid $pid ($user): $what"; done <<< "$PROCS"
    if grep -q -v -P "\t$me\t" <<< "$PROCS"; then
      fail "some of these processes belong to another user; stop them as that user first. Nothing was changed."
    fi
    if grep -q -E 'install-linux\.sh|uninstall-linux\.sh' <<< "$PROCS"; then
      fail "the installer or another uninstall is running for this folder; wait for it to finish. Nothing was changed."
    fi
  else
    info "No HexOps processes of this installation are running."
  fi

  DROP_DB=no; DROP_ROLE=no; DB_NOTE=""
  if [ "$MODE" = purge ]; then check_database; fi

  collect_files
  say "Plan ($([ "$MODE" = purge ] && echo 'FULL PURGE' || echo 'remove the application, keep data'))"
  if [ "$MODE" = purge ]; then
    [ "$DROP_DB" = yes ] && info "PostgreSQL (this computer, port $DB_PORT): DROP DATABASE \"$DB_NAME\""
    [ "$DROP_ROLE" = yes ] && info "PostgreSQL (this computer, port $DB_PORT): DROP ROLE \"$DB_USER\""
    [ -z "$DB_NOTE" ] || info "PostgreSQL: $DB_NOTE"
  else
    [ -f "$ENV_FILE" ] && info "Kept: $ENV_FILE (database address and secret key)"
    [ -e "$ROOT/data" ] && info "Kept: $ROOT/data/ (evidence uploads, backups)"
    info "Kept: the PostgreSQL database and role."
  fi
  [ -z "$export_abs" ] || info "First saved: encrypted export to $export_abs"
  if [ "${#DELETE[@]}" -gt 0 ]; then
    info "Deleted:"
    for p in "${DELETE[@]}"; do info "  $(describe "$p")"; done
  else
    info "No application files left to delete."
  fi
  if [ "${#LEFT[@]}" -gt 0 ]; then
    info "Left in place (not part of HexOps):"
    for p in "${LEFT[@]}"; do info "  $p"; done
  fi
  local outside; outside="$(configured_outside)"
  if [ -n "$outside" ] && [ "$MODE" = purge ]; then
    info "Configured outside this folder and NOT deleted (delete by hand if you want):"
    while read -r line; do info "  $line"; done <<< "$outside"
  fi
  info "Never touched: Python, Node.js, PostgreSQL itself, other databases, browsers, ~/.cache/ms-playwright."

  if [ -z "$PROCS" ] && [ "${#DELETE[@]}" -eq 0 ] && [ "$DROP_DB" = no ] && [ "$DROP_ROLE" = no ]; then
    say "Nothing to do: HexOps is already removed from $ROOT."
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then say "Dry run: nothing was changed."; return 0; fi

  if [ "$MODE" = purge ]; then
    if [ -z "$export_abs" ]; then
      info ""
      info "No backup requested. To keep your data, answer no and rerun with --export FILE,"
      info "or export it from Settings → Data. After this, the data cannot be recovered."
    fi
    printf '\nType %s to delete all of the above: ' "$CONFIRM_WORD"
    local answer=""; read -r answer || true
    [ "$answer" = "$CONFIRM_WORD" ] || fail "not confirmed; nothing was changed."
  elif [ "$ASSUME_YES" -eq 0 ]; then
    printf '\nRemove the HexOps application from %s? [y/N] ' "$ROOT"
    local answer=""; read -r answer || true
    [[ "$answer" =~ ^(y|yes|Y|YES)$ ]] || fail "cancelled; nothing was changed."
  fi

  say "Stopping HexOps"
  stop_processes

  if [ -n "$export_abs" ]; then
    say "Saving the encrypted export"
    (cd "$BACKEND" && .venv/bin/python -m app.modules.transfer.cli export "$export_abs") \
      || fail "the export failed; nothing was deleted (HexOps was only stopped)."
  fi

  if [ "$MODE" = purge ] && { [ "$DROP_DB" = yes ] || [ "$DROP_ROLE" = yes ]; }; then
    say "Removing the PostgreSQL database and role"
    CHECKS="$(admin_psql postgres -v db="$DB_NAME" -v role="$DB_USER" < "$SQL_DIR/cluster_check.sql")" \
      || fail "cannot check the database again; nothing was deleted."
    [ "$(kv sessions_db)" = 0 ] || fail "something is still connected to '$DB_NAME'; nothing was deleted." \
      "Close whatever uses it (another HexOps copy? a database tool?) and run this again."
    admin_psql postgres -v db="$DB_NAME" -v role="$DB_USER" -v drop_db="$DROP_DB" -v drop_role="$DROP_ROLE" \
      < "$SQL_DIR/drop.sql" >/dev/null \
      || fail "PostgreSQL refused to drop the database or role (see above); no files were deleted." \
              "Fix the reason and run this again; it continues where it stopped."
    [ "$DROP_DB" = yes ] && info "Dropped database \"$DB_NAME\"."
    [ "$DROP_ROLE" = yes ] && info "Dropped role \"$DB_USER\"."
  fi

  say "Deleting files"
  local p failed=0
  for p in "${DELETE[@]}"; do
    rm -rf -- "$p" 2>/dev/null || true
    if [ -e "$p" ] || [ -L "$p" ]; then info "could not delete: $p"; failed=1; fi
  done
  rmdir -- "$BACKEND" 2>/dev/null || true
  if [ "$MODE" = purge ]; then rmdir -- "$ROOT" 2>/dev/null || true; fi
  [ "$failed" -eq 0 ] || fail "some files could not be deleted (listed above); run this again after fixing permissions."

  if [ "$MODE" = purge ]; then
    say "HexOps was removed completely."
    if [ -d "$ROOT" ]; then info "$ROOT still holds files that are not part of HexOps (listed above)."
    else info "The folder $ROOT is gone. If your terminal was inside it, run: cd ~"; fi
  else
    say "The HexOps application was removed. Your data is kept:"
    [ -f "$ENV_FILE" ] && info "$ENV_FILE"
    [ -d "$ROOT/data" ] && info "$ROOT/data/"
    info "PostgreSQL database '${DB_NAME:-(from backend/.env)}' is unchanged."
    info ""
    info "To reinstall with the same data: put a fresh copy of HexOps into $ROOT"
    info "(git clone https://github.com/KhusanJuraev/HexOps.git, or unpack the ZIP there),"
    info "keep backend/.env and data/ where they are, and run ./install-linux.sh."
  fi
}

main "$@"; exit $?
