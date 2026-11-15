#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Bottle — double-click me to start.
#  Keep this window open while you review. Close it to stop.
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd)"
PORT="${BOTTLE_PORT:-4317}"
URL="http://127.0.0.1:$PORT"

bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; reset=$'\033[0m'
say()  { echo "  $1"; }
step() { echo; echo "  ${bold}$1${reset}"; }
ok()   { echo "  ${green}✓${reset} $1"; }
dialog() { /usr/bin/osascript -e "display dialog \"$1\" with title \"Bottle\" buttons {\"OK\"} default button 1 with icon note" >/dev/null 2>&1; }

clear
echo
echo "  ${bold}🍾  Bottle${reset}  ${dim}— local video review${reset}"

# 1) Already running? Just open it.
if curl -fs "$URL/api/health" >/dev/null 2>&1; then
  ok "Bottle is already running — opening your browser."
  open "$URL"
  exit 0
fi

# 2) Find Node.js (Homebrew, nvm, Volta, or the official installer).
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major; major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
  [ -n "$major" ] && [ "$major" -ge 20 ]
}

if ! node_ok; then
  step "Bottle needs Node.js (free, takes about a minute)."
  answer=$(/usr/bin/osascript -e 'button returned of (display dialog "Bottle needs Node.js to run. It is free and safe — made by the OpenJS Foundation.\n\nInstall it now? The standard macOS installer will open; just click Continue until it finishes." with title "Bottle" buttons {"Not now", "Install Node.js"} default button 2 with icon note)' 2>/dev/null)
  if [ "$answer" != "Install Node.js" ]; then
    say "No problem. When you're ready, install Node.js from https://nodejs.org and double-click Start.command again."
    open "https://nodejs.org/en/download" ; exit 1
  fi
  say "Downloading the official Node.js installer…"
  PKG_NAME=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '{print $2}' | grep -E '^node-v22\.[0-9.]+\.pkg$' | head -1)
  if [ -z "$PKG_NAME" ] || ! curl -fL --progress-bar -o "/tmp/$PKG_NAME" "https://nodejs.org/dist/latest-v22.x/$PKG_NAME"; then
    say "Couldn't download it automatically — opening nodejs.org instead. Install the LTS version, then run me again."
    open "https://nodejs.org/en/download"; exit 1
  fi
  open "/tmp/$PKG_NAME"
  say "The installer is open. Finish it, and I'll continue automatically…"
  for _ in $(seq 1 300); do sleep 3; node_ok && break; done
  if ! node_ok; then say "Still can't find Node.js. Finish the installer, then double-click Start.command again."; exit 1; fi
fi
ok "Node.js $(node -v)"

# 3) First run (or after an update): install dependencies.
NODE_V="$(node -v)"
STAMP="node_modules/.bottle-install"
if [ ! -f "$STAMP" ] || [ package.json -nt "$STAMP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$NODE_V" ]; then
  step "Setting things up (first run only, about a minute)…"
  if ! npm install --no-audit --no-fund --loglevel=error; then
    dialog "Setup couldn't finish. Check your internet connection and double-click Start.command again."
    exit 1
  fi
  echo "$NODE_V" > "$STAMP"
  ok "Installed"
fi

# 4) Build the app if needed.
if [ ! -f dist/server/index.js ] || [ ! -f dist/web/index.html ] || [ -n "$(find web server package.json -newer dist/.built -print -quit 2>/dev/null)" ]; then
  step "Preparing Bottle…"
  if ! npm run build --silent >/tmp/bottle-build.log 2>&1; then
    cat /tmp/bottle-build.log
    dialog "Bottle couldn't be prepared. The details are in the Terminal window."
    exit 1
  fi
  touch dist/.built
  ok "Ready"
fi

# 5) Start the server and open the browser.
echo
exec node dist/server/index.js --open
