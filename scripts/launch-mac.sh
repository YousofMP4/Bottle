#!/bin/bash
# Starts Portal in the background (no Terminal window) and opens it in the browser.
# Used by Portal.app (see scripts/make-mac-app.sh). Safe to run when Portal is already running.
cd "$(dirname "$0")/.." || exit 1
PORT="${PORTAL_PORT:-${BOTTLE_PORT:-4317}}"
URL="http://127.0.0.1:$PORT"
LOG="$HOME/Library/Logs/Portal.log"

up() { curl -fs "$URL/api/health" >/dev/null 2>&1; }

# Already running? Just open it.
if up; then open "$URL"; exit 0; fi

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

# First run, missing Node.js or dependencies, or a failed build: hand over to Start.command,
# which walks through setup in a Terminal window.
setup() { open -a Terminal "$(pwd)/Start.command"; exit 0; }
command -v node >/dev/null 2>&1 || setup
NODE_V="$(node -v)"
STAMP="node_modules/.portal-install"
if [ ! -f "$STAMP" ] || [ package.json -nt "$STAMP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$NODE_V" ]; then setup; fi

# Rebuild if the source changed since the last build.
if [ ! -f dist/server/index.js ] || [ ! -f dist/web/index.html ] || [ -n "$(find web server package.json -newer dist/.built -print -quit 2>/dev/null)" ]; then
  npm run build --silent >"$LOG" 2>&1 || setup
  touch dist/.built
fi

mkdir -p "$(dirname "$LOG")"
nohup node dist/server/index.js >>"$LOG" 2>&1 &
disown

for _ in $(seq 1 40); do up && break; sleep 0.25; done
if up; then open "$URL"
else /usr/bin/osascript -e "display dialog \"Portal didn't start. Details are in $LOG\" with title \"Portal\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
fi
