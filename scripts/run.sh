#!/usr/bin/env bash
# Start PramaanSetu on macOS or Linux: install, seed, build and run both services.
#
#   ./scripts/run.sh            install if needed, seed if empty, start both
#   ./scripts/run.sh --reset    drop the database and seed it again first
#   ./scripts/run.sh --stop     stop both services
#   ./scripts/run.sh --status   say what is running, and what is holding each port
#
# Both services are started detached so this shell is free afterwards. That is also why
# they survive closing the terminal, which is the usual cause of "address already in
# use": the process ids are recorded under .run so --stop can end exactly those, and
# anything else squatting on a port is named rather than killed silently.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
RUN_DIR="$ROOT/.run"

API_PORT=8000
WEB_PORT=3000

RESET=0
SKIP_INSTALL=0
SKIP_BUILD=0

step() { printf "\n==> %s\n" "$1"; }

port_owner() {
  lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

recorded_pid() {
  local file="$RUN_DIR/$1.pid"
  [ -f "$file" ] && cat "$file" || true
}

stop_service() {
  local name="$1" port="$2" stopped=0 pid

  pid="$(recorded_pid "$name")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Stopping $name (pid $pid)"
    kill -9 "$pid" 2>/dev/null || true
    stopped=1
  fi
  rm -f "$RUN_DIR/$name.pid"

  pid="$(port_owner "$port")"
  if [ -n "$pid" ]; then
    echo "Stopping the process on port $port (pid $pid)"
    kill -9 "$pid" 2>/dev/null || true
    stopped=1
  fi

  [ "$stopped" -eq 1 ] && sleep 1
  return 0
}

assert_port_free() {
  local port="$1" label="$2" pid
  pid="$(port_owner "$port")"
  if [ -n "$pid" ]; then
    echo "" >&2
    echo "Port $port is still held by pid $pid." >&2
    echo "$label cannot start. Close that process, or run: ./scripts/run.sh --stop" >&2
    exit 1
  fi
}

show_tail() {
  if [ -f "$1" ]; then
    echo "--- last ${2:-25} lines of $(basename "$1") ---"
    tail -n "${2:-25}" "$1"
  fi
}

for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --status)
      step "PramaanSetu status"
      for pair in "api:$API_PORT" "web:$WEB_PORT"; do
        name="${pair%%:*}"; port="${pair##*:}"
        pid="$(port_owner "$port")"
        if [ -n "$pid" ]; then
          if [ "$(recorded_pid "$name")" = "$pid" ]; then ours="started by this script"
          else ours="not started by this script"; fi
          echo "  port $port: pid $pid, $ours"
        else
          echo "  port $port: free"
        fi
      done
      exit 0
      ;;
    --stop)
      step "Stopping PramaanSetu"
      stop_service "api" "$API_PORT"
      stop_service "web" "$WEB_PORT"
      echo "Stopped."
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step "Checking the toolchain"
command -v python3 >/dev/null || { echo "Python 3.11 or later is required." >&2; exit 1; }
command -v node >/dev/null || { echo "Node 20 or later is required." >&2; exit 1; }
python3 --version
node --version

if [ "$SKIP_INSTALL" -eq 0 ]; then
  step "Installing backend dependencies"
  (cd "$BACKEND" && python3 -m pip install --disable-pip-version-check --quiet -r requirements-dev.txt)

  step "Installing web dependencies"
  (cd "$FRONTEND" && { [ -f package-lock.json ] && npm ci --no-audit --no-fund || npm install --no-audit --no-fund; })
fi

step "Preparing the database"
if [ "$RESET" -eq 1 ] || [ ! -f "$BACKEND/pramaansetu.db" ]; then
  (cd "$BACKEND" && python3 -m app.seed --reset)
else
  echo "Database present. Pass --reset to rebuild it."
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  step "Building the web application"
  (cd "$FRONTEND" && npm run build)
fi

# Free both ports before either service starts, so a half-started stack cannot happen.
step "Clearing ports $API_PORT and $WEB_PORT"
stop_service "api" "$API_PORT"
stop_service "web" "$WEB_PORT"
assert_port_free "$API_PORT" "The API"
assert_port_free "$WEB_PORT" "The web application"

mkdir -p "$RUN_DIR"

step "Starting the API on port $API_PORT"
(cd "$BACKEND" && nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" \
  > "$ROOT/api.log" 2>&1 & echo $! > "$RUN_DIR/api.pid")
echo "pid $(cat "$RUN_DIR/api.pid")"

step "Starting the web application on port $WEB_PORT"
(cd "$FRONTEND" && nohup npm run start > "$ROOT/web.log" 2>&1 & echo $! > "$RUN_DIR/web.pid")
echo "pid $(cat "$RUN_DIR/web.pid")"

step "Waiting for both services"
ready=0
for _ in $(seq 1 40); do
  api="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/v1/healthz" || true)"
  web="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)"
  if [ "$api" = "200" ] && [ "$web" = "200" ]; then ready=1; break; fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "" >&2
  echo "The services did not come up within 80 seconds." >&2
  show_tail "$ROOT/api.log"
  show_tail "$ROOT/web.log"
  exit 1
fi

# "npm run start" spawns node as a child, so the process recorded above is not the one
# holding the port. Record the actual listeners now that both are up, which makes
# --status truthful and --stop precise.
for pair in "api:$API_PORT" "web:$WEB_PORT"; do
  name="${pair%%:*}"; port="${pair##*:}"
  owner="$(port_owner "$port")"
  [ -n "$owner" ] && echo "$owner" > "$RUN_DIR/$name.pid"
done

step "Running the smoke test"
python3 "$ROOT/scripts/smoke_test.py"

cat <<INFO

PramaanSetu is running.
  Web application:  http://localhost:$WEB_PORT
  API:              http://localhost:$API_PORT
  API docs:         http://localhost:$API_PORT/docs

Sign in at http://localhost:$WEB_PORT/signin. Every seeded account uses the password
PramaanSetu@2026, and the sign-in page lists one account per role.

Stop with:   ./scripts/run.sh --stop
Check with:  ./scripts/run.sh --status
INFO
