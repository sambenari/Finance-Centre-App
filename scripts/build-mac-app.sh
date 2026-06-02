#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Finance Centre"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_RESOURCES_DIR="$RESOURCES_DIR/app"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$APP_RESOURCES_DIR/src" "$APP_RESOURCES_DIR/database"

cp "$ROOT_DIR/index.html" "$APP_RESOURCES_DIR/index.html"
cp "$ROOT_DIR/server.py" "$APP_RESOURCES_DIR/server.py"
cp "$ROOT_DIR/src/app.js" "$APP_RESOURCES_DIR/src/app.js"
cp "$ROOT_DIR/src/styles.css" "$APP_RESOURCES_DIR/src/styles.css"
cp "$ROOT_DIR/database/schema.sql" "$APP_RESOURCES_DIR/database/schema.sql"

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Finance Centre</string>
  <key>CFBundleDisplayName</key>
  <string>Finance Centre</string>
  <key>CFBundleIdentifier</key>
  <string>local.finance.centre</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleExecutable</key>
  <string>FinanceCentre</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$MACOS_DIR/FinanceCentre" <<'LAUNCHER'
#!/usr/bin/env zsh
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_RESOURCES="$APP_ROOT/Resources/app"
APP_SUPPORT="$HOME/Library/Application Support/Finance Centre"
PID_FILE="$APP_SUPPORT/finance-centre-http-server.pid"
LOG_FILE="$APP_SUPPORT/finance-centre-http-server.log"
DB_FILE="$APP_SUPPORT/finance-centre.sqlite3"
PORT_FILE="$APP_SUPPORT/finance-centre-http-server.port"
PORT="${FINANCE_CENTRE_PORT:-4273}"

mkdir -p "$APP_SUPPORT"

is_server_ready() {
  /usr/bin/curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1
}

is_port_listening() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

choose_port() {
  if [[ -n "${FINANCE_CENTRE_PORT:-}" ]]; then
    return
  fi

  if ! is_port_listening "$PORT" || is_server_ready; then
    return
  fi

  for CANDIDATE in {4274..4299}; do
    if ! is_port_listening "$CANDIDATE"; then
      PORT="$CANDIDATE"
      return
    fi
  done
}

if [[ -f "$PORT_FILE" ]]; then
  SAVED_PORT="$(cat "$PORT_FILE" 2>/dev/null || true)"
  if [[ -n "$SAVED_PORT" ]]; then
    PORT="$SAVED_PORT"
  fi
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null && is_server_ready; then
    open "http://127.0.0.1:$PORT/"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

choose_port

echo "$PORT" > "$PORT_FILE"

if /usr/bin/python3 "$APP_RESOURCES/server.py" --host 127.0.0.1 --port "$PORT" --db "$DB_FILE" > "$LOG_FILE" 2>&1 & then
  SERVER_PID="$!"
  echo "$SERVER_PID" > "$PID_FILE"
  for _ in {1..30}; do
    if is_server_ready; then
      break
    fi
    sleep 0.2
  done
  open "http://127.0.0.1:$PORT/"
else
  open "http://127.0.0.1:$PORT/"
fi
LAUNCHER

chmod +x "$MACOS_DIR/FinanceCentre"

echo "Built $APP_DIR"
