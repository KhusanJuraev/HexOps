#!/usr/bin/env bash
# Start HexOps (API + production UI) on 127.0.0.1. Stop with Ctrl+C.
#   ./start-linux.sh           # start and print the URL
#   ./start-linux.sh --open    # also open it in the default browser
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
ENV_FILE="$BACKEND/.env"
OPEN=0
[ "${1:-}" = "--open" ] && OPEN=1

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || die "start HexOps as your normal user, not root."
if [ ! -f "$ENV_FILE" ] || [ ! -x "$BACKEND/.venv/bin/python" ] || [ ! -f "$FRONTEND/dist/index.html" ]; then
  die "HexOps is not installed yet. Run ./install-linux.sh first."
fi

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
API_PORT="$(env_value HEXOPS_PORT)"; API_PORT="${API_PORT:-8000}"
UI_PORT="$(env_value HEXOPS_UI_PORT)"; UI_PORT="${UI_PORT:-4173}"
URL="http://127.0.0.1:$UI_PORT"

(cd "$BACKEND" && exec .venv/bin/python -m app) &
API_PID=$!
# vite itself (not through npx), so the PID we stop is the server process.
(cd "$FRONTEND" && HEXOPS_API_URL="http://127.0.0.1:$API_PORT" exec ./node_modules/.bin/vite preview --port "$UI_PORT") &
UI_PID=$!
# shellcheck disable=SC2317  # called from the traps below
stop() {
  for pid in "$API_PID" "$UI_PID"; do
    pkill -TERM -P "$pid" 2>/dev/null || true  # anything they started
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait "$API_PID" "$UI_PID" 2>/dev/null || true
}
trap 'stop; exit 0' INT TERM HUP
trap 'stop' EXIT

ready() { "$BACKEND/.venv/bin/python" -c "import sys,urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2)" "$1" >/dev/null 2>&1; }
for _ in $(seq 1 60); do
  kill -0 "$API_PID" 2>/dev/null || die "the API stopped — see the messages above (database running? port $API_PORT free?)"
  kill -0 "$UI_PID" 2>/dev/null || die "the UI stopped — see the messages above (port $UI_PORT free?)"
  if ready "http://127.0.0.1:$API_PORT/api/health" && ready "$URL/"; then
    printf '\nHexOps is running: %s   (Ctrl+C to stop)\n\n' "$URL"
    if [ "$OPEN" -eq 1 ] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
    wait "$API_PID" "$UI_PID"
    exit 0
  fi
  sleep 1
done
die "HexOps did not start within 60 seconds."
