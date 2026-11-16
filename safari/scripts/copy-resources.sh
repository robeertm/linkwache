#!/bin/sh
# Xcode build phase of "Linkwache for Safari" (both targets call it). Copies the web part of the extension, built from the
# same source as the Chromium/Firefox extension (node extension/scripts/build.mjs safari), into the app extension, and
# the container app's texts into the app. Builds the extension first when it is missing and node is available.
set -eu
ROOT="${SRCROOT}/.."
DIST="${ROOT}/extension/dist"
RES="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"

if [ ! -f "${DIST}/safari/manifest.json" ] || [ ! -f "${DIST}/safari-app-strings.json" ]; then
  NODE="$(command -v node || true)"
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do [ -n "${NODE}" ] || { [ -x "$c" ] && NODE="$c"; }; done
  if [ -z "${NODE}" ]; then
    echo "error: extension/dist/safari is missing. Run 'npm ci && node extension/scripts/build.mjs safari' first (or safari/scripts/build-local.sh)." >&2
    exit 1
  fi
  (cd "${ROOT}" && "${NODE}" extension/scripts/build.mjs safari)
fi

mkdir -p "${RES}"
case "${1:-}" in
  extension)
    # Web resources at the root of the extension's Resources folder (manifest.json, scripts, pages, icons, _locales).
    rsync -a --delete --exclude '.DS_Store' "${DIST}/safari/" "${RES}/"
    ;;
  app)
    cp "${DIST}/safari-app-strings.json" "${RES}/app-strings.json"
    ;;
  *) echo "usage: copy-resources.sh extension|app" >&2; exit 2 ;;
esac

# Version from the extension build when the project is built without MARKETING_VERSION (e.g. straight from Xcode).
if [ "${MARKETING_VERSION:-0.0.0}" = "0.0.0" ] && [ -f "${TARGET_BUILD_DIR}/${INFOPLIST_PATH}" ]; then
  V="$(/usr/bin/sed -n 's/^  "version": "\(.*\)".*/\1/p' "${DIST}/safari/manifest.json" | head -1)"
  [ -n "${V}" ] && /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${V}" "${TARGET_BUILD_DIR}/${INFOPLIST_PATH}" || true
fi
