#!/bin/bash
# Builds "Linkwache for Safari" on this Mac, copies it to /Applications and opens it once (docs/DESKTOP.md "Safari").
#
#   safari/scripts/build-local.sh                   free "Personal Team" of your Apple ID (sign in once in Xcode → Settings → Accounts)
#   DEVELOPMENT_TEAM=ABCDE12345 safari/scripts/build-local.sh   pick the team explicitly
#   safari/scripts/build-local.sh --adhoc           no Apple ID: signed only locally; Safari then needs "Allow unsigned extensions"
#
# Options: --adhoc, --no-install (only build into safari/build), --no-open, --dest DIR (instead of /Applications).
# Environment: LINKWACHE_DEFAULT_SERVER=https://... builds the extension with this server address preset
# (otherwise the address is set once in the extension's settings).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SAFARI="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$SAFARI/.." && pwd)"
ADHOC=0; INSTALL=1; OPEN=1; DEST="/Applications"
while [ $# -gt 0 ]; do
  case "$1" in
    --adhoc) ADHOC=1 ;;
    --no-install) INSTALL=0 ;;
    --no-open) OPEN=0 ;;
    --dest) DEST="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this script runs on macOS only."

# 1. Xcode (not just the Command Line Tools)
DEV="$(xcode-select -p 2>/dev/null || true)"
if [ -z "$DEV" ] || [ ! -d "$DEV/Platforms" ]; then
  if [ -d /Applications/Xcode.app/Contents/Developer ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
    echo "xcode-select points to the Command Line Tools; using /Applications/Xcode.app for this build."
  else
    die "Xcode is needed (free in the App Store). The Command Line Tools alone cannot build Safari extensions."
  fi
fi
xcodebuild -version | sed -n 1p   # sed reads everything: no broken pipe under pipefail
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  die "Xcode has not finished its first start. Open Xcode once (or run: sudo xcodebuild -runFirstLaunch), then try again."
fi

# 2. Extension (same source as the Chromium/Firefox extension)
command -v node >/dev/null || die "Node.js 20+ is needed (https://nodejs.org or 'brew install node')."
say "Building the extension"
cd "$ROOT"
[ -d node_modules/esbuild ] || npm ci --no-audit --no-fund
node extension/scripts/build.mjs safari
VERSION="$(node -p 'require("./package.json").version')"

# 3. Signing: Personal Team (default) or ad hoc
SIGN=()
if [ "$ADHOC" = 1 ]; then
  SIGN=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
  echo "Signing: ad hoc (no Apple ID)."
else
  TEAM="${DEVELOPMENT_TEAM:-}"
  if [ -z "$TEAM" ]; then
    # The free Personal Team appears as "Apple Development: <name> (TEAMID)" once you are signed in in Xcode
    # and Xcode has created a development certificate (first build from Xcode or -allowProvisioningUpdates).
    TEAM="$(security find-certificate -a -c "Apple Development" -p 2>/dev/null \
      | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | sed -n 1p || true)"
  fi
  if [ -z "$TEAM" ]; then
    TEAM="$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | sed -n 's/.*teamID = \([A-Z0-9]\{10\}\);.*/\1/p' | sed -n 1p || true)"
  fi
  if [ -z "$TEAM" ]; then
    cat >&2 <<'MSG'

No signing team found. Either:
  a) open Xcode → Settings → Accounts, add your Apple ID (free), then run this script again, or
  b) run it with --adhoc (Safari then needs Settings → Developer → "Allow unsigned extensions", after every restart).
MSG
    exit 3
  fi
  SIGN=(DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
  echo "Signing: team $TEAM (automatic provisioning)."
fi

# 4. Build
say "Building Linkwache for Safari $VERSION"
BUILD="$SAFARI/build"
rm -rf "$BUILD"
xcodebuild -project "$SAFARI/Linkwache.xcodeproj" -target "Linkwache for Safari" -configuration Release \
  SYMROOT="$BUILD" OBJROOT="$BUILD/obj" MARKETING_VERSION="$VERSION" "${SIGN[@]}" -quiet build
APP="$BUILD/Release/Linkwache for Safari.app"
[ -d "$APP/Contents/PlugIns/Linkwache Extension.appex" ] || die "build finished without the extension inside the app."
codesign --verify --deep --strict "$APP" && echo "Signature verified."

if [ "$INSTALL" = 0 ]; then echo "Built: $APP"; exit 0; fi

# 5. Install: keep the previous version as a backup until the new one is in place
say "Installing to $DEST"
TARGET="$DEST/Linkwache for Safari.app"
if [ -d "$TARGET" ]; then
  osascript -e 'tell application id "app.linkwache.safari" to quit' >/dev/null 2>&1 || true
  BACKUP="$(mktemp -d "${TMPDIR:-/tmp}/linkwache-safari-backup.XXXXXX")"
  mv "$TARGET" "$BACKUP/"
  if ! ditto "$APP" "$TARGET"; then mv "$BACKUP/Linkwache for Safari.app" "$TARGET"; die "copy failed, previous version restored."; fi
  rm -rf "$BACKUP"
else
  ditto "$APP" "$TARGET"
fi
# Register with Launch Services so Safari lists the extension right away.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET" >/dev/null 2>&1 || true
[ "$OPEN" = 1 ] && open "$TARGET"

cat <<MSG

Done: Linkwache for Safari $VERSION is in $DEST.

Now in Safari:
  1. Safari → Settings → Extensions → tick "Linkwache".
  2. Allow it on all websites when Safari asks ("Always allow on every website").
MSG
if [ "$ADHOC" = 1 ]; then cat <<'MSG'
  Ad-hoc build: first Safari → Settings → Advanced → tick "Show features for web developers",
  then Safari → Settings → Developer → tick "Allow unsigned extensions" (Safari resets this after every restart).
MSG
fi
[ -n "${LINKWACHE_DEFAULT_SERVER:-}" ] || echo "  Server address: set it once in the extension's settings (Safari → Settings → Extensions → Linkwache → Settings)."
