#!/bin/bash
# Builds Portal.app, a double-clickable launcher that finds Spotlight and the Dock.
# Usage: scripts/make-mac-app.sh [destination folder]   (default: /Applications, else ~/Applications)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/Applications}"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
APP="$DEST/Portal.app"
chmod +x "$ROOT/scripts/launch-mac.sh"

SRC="$(mktemp -t portal).applescript"
cat > "$SRC" <<EOF
do shell script quoted form of "$ROOT/scripts/launch-mac.sh" & " > /dev/null 2>&1"
EOF
rm -rf "$APP"
/usr/bin/osacompile -o "$APP" "$SRC"
rm -f "$SRC"

# Icon: render web/public/favicon.svg into an .icns (best effort; keeps the default icon on failure).
TMP="$(mktemp -d)"
if /usr/bin/qlmanage -t -s 1024 -o "$TMP" "$ROOT/web/public/favicon.svg" >/dev/null 2>&1 && [ -f "$TMP/favicon.svg.png" ]; then
  SET="$TMP/Portal.iconset"; mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    /usr/bin/sips -z $s $s "$TMP/favicon.svg.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
    /usr/bin/sips -z $((s*2)) $((s*2)) "$TMP/favicon.svg.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  if /usr/bin/iconutil -c icns "$SET" -o "$APP/Contents/Resources/applet.icns"; then
    # osacompile also ships its default icon in Assets.car, which macOS prefers over the .icns.
    rm -f "$APP/Contents/Resources/Assets.car"
    /usr/bin/plutil -remove CFBundleIconName "$APP/Contents/Info.plist" 2>/dev/null || true
  fi
fi
rm -rf "$TMP"
/usr/bin/plutil -replace CFBundleIdentifier -string "app.portal.launcher" "$APP/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleName -string "Portal" "$APP/Contents/Info.plist"
# Editing the bundle invalidates osacompile's ad-hoc signature; sign it again so macOS will open it.
/usr/bin/codesign --force --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
echo "Installed $APP"
