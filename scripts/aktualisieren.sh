#!/bin/bash
# Fetch a published release and roll it out with scripts/ausrollen.sh (backup + automatic rollback included).
#
#   LINKWACHE_NAS=user@host scripts/aktualisieren.sh                 # latest release, if newer than the running one
#   LINKWACHE_NAS=user@host scripts/aktualisieren.sh --if-requested  # only if the operator page filed a request
#   LINKWACHE_NAS=user@host scripts/aktualisieren.sh v0.4.1          # a specific release
#   DRY_RUN=1 ...                                                    # run every check, change nothing on the host
#
# Checks before anything is swapped: the tag must exist, package.json of that tag must carry the same version,
# no commit in the tag may carry a private identity (scripts/check_commit_identity.py), and the tests must pass.
# Switches: SKIP_INSTALL=1 (dependencies already present), LINKWACHE_REPO (default robeertm/linkwache), LINKWACHE_GIT (clone source, for offline tests),
# LINKWACHE_DATA (data dir on the host, default $LINKWACHE_DIR/data), LINKWACHE_PORT (default 8081).
set -euo pipefail

NAS="${LINKWACHE_NAS:?set LINKWACHE_NAS=user@host}"
DIR="${LINKWACHE_DIR:-/volume1/docker/linkwache}"
DATA="${LINKWACHE_DATA:-$DIR/data}"
PORT="${LINKWACHE_PORT:-8081}"
REPO="${LINKWACHE_REPO:-robeertm/linkwache}"
GIT_URL="${LINKWACHE_GIT:-https://github.com/$REPO}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "bad LINKWACHE_REPO"; exit 2; }
[[ "$DATA" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "bad LINKWACHE_DATA"; exit 2; }
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "bad LINKWACHE_PORT"; exit 2; }
export LINKWACHE_NAS="$NAS" LINKWACHE_DIR="$DIR" LINKWACHE_PORT="$PORT"
PATHFIX='export PATH=/usr/local/bin:$PATH;'

MODE=latest; WANT=""
case "${1:-}" in
  "") ;;
  --if-requested) MODE=requested ;;
  v[0-9]*) WANT="$1" ;;
  *) echo "usage: $0 [--if-requested | vX.Y.Z]"; exit 2 ;;
esac
[[ -z "$WANT" || "$WANT" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad version"; exit 2; }

RUN_V=$(ssh -o BatchMode=yes "$NAS" "curl -fsS --max-time 10 http://127.0.0.1:$PORT/api/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p') || true
[ -n "$RUN_V" ] || { echo "cannot read the running version from $NAS (container down?), refusing"; exit 1; }
echo "running: $RUN_V"

newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]; }

REQ_FILE="$DATA/update-request.json"
if [ "$MODE" = requested ]; then
  REQ=$(ssh -o BatchMode=yes "$NAS" "cat $REQ_FILE 2>/dev/null" || true)
  [ -n "$REQ" ] || { echo "no update request filed"; exit 0; }
  WANT="v$(printf '%s' "$REQ" | sed -n 's/.*"version":"\([0-9.]*\)".*/\1/p')"
  [[ "$WANT" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "request file unreadable, ignoring"; exit 1; }
  echo "operator requested $WANT"
fi
if [ -z "$WANT" ]; then
  WANT=$(curl -fsS --max-time 15 -H 'accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\(v[0-9.]*\)".*/\1/p' | head -n1)
  [ -n "$WANT" ] || { echo "could not read the latest release"; exit 1; }
fi
if ! newer "${WANT#v}" "$RUN_V"; then echo "already up to date ($RUN_V, wanted $WANT)"; exit 0; fi

WORK=$(mktemp -d -t lw-update.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
git clone --quiet --depth 1 --branch "$WANT" "$GIT_URL" "$WORK/src" 2>&1 || { echo "tag $WANT not found"; exit 1; }
cd "$WORK/src"
GOT=$(node -p "require('./package.json').version")
[ "$GOT" = "${WANT#v}" ] || { echo "tag $WANT carries package.json version $GOT, refusing"; exit 1; }
[ -x scripts/ausrollen.sh ] || [ -f scripts/ausrollen.sh ] || { echo "release has no scripts/ausrollen.sh"; exit 1; }
[ "${SKIP_INSTALL:-0}" = 1 ] || npm ci --silent --ignore-scripts >/dev/null 2>&1 || { echo "npm ci failed"; exit 1; }
npm test --silent >/dev/null 2>&1 || { echo "tests of $WANT failed, nothing changed"; exit 1; }
echo "release $WANT verified (version, tests)"

SKIP_TESTS=1 bash scripts/ausrollen.sh
[ "${DRY_RUN:-0}" = 1 ] && exit 0

# Request fulfilled: remove it (the file belongs to the container user, so as root in a throwaway container).
if [ "$MODE" = requested ]; then
  ssh -o BatchMode=yes "$NAS" "$PATHFIX sudo -n docker run --rm --user 0 -v $DATA:/d alpine:3 rm -f /d/update-request.json" || echo "note: could not remove the request file"
fi
echo "ok: updated $RUN_V -> $GOT"
