#!/bin/bash
# Roll out the current Git HEAD to the self-hosted NAS container, with backup and automatic rollback.
#
#   LINKWACHE_NAS=user@host scripts/ausrollen.sh
#
# Steps: tests -> pack HEAD -> back up the running source + tag the running image -> swap source ->
#        docker build -> compose up -> check /api/health (version) + Docker health -> on any failure restore everything.
# Known traps handled here: docker is not on PATH in a non-interactive DSM shell, source files belong to a
# different UID than the SSH user (so all file work runs as root in a throwaway container), and a leftover
# src.old must never survive a run.
set -euo pipefail

NAS="${LINKWACHE_NAS:?set LINKWACHE_NAS=user@host (needs sudo for docker and docker-compose only)}"
DIR="${LINKWACHE_DIR:-/volume1/docker/linkwache}"
NAME="${LINKWACHE_CONTAINER:-linkwache}"
PORT="${LINKWACHE_PORT:-8081}"
cd "$(cd "$(dirname "$0")/.." && pwd)"

[[ "$DIR" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "bad LINKWACHE_DIR"; exit 2; }
[[ "$NAME" =~ ^[a-z0-9][a-z0-9_.-]*$ ]] || { echo "bad LINKWACHE_CONTAINER"; exit 2; }
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "bad LINKWACHE_PORT"; exit 2; }

VERSION=$(node -p "require('./package.json').version")
STAMP=$(date +%Y%m%d-%H%M%S)
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree has uncommitted changes: commit first (the rollout ships HEAD)"; exit 2; }

echo "== Linkwache $VERSION -> $NAS:$DIR"
if [ "${SKIP_TESTS:-0}" != "1" ]; then npm test --silent >/dev/null && echo "tests ok"; fi
[ "${DRY_RUN:-0}" = "1" ] && { echo "dry run: stopping before any change"; exit 0; }

TAR=$(mktemp -t lw-rollout).tar
trap 'rm -f "$TAR"' EXIT
COPYFILE_DISABLE=1 git archive --format=tar HEAD > "$TAR"
REMOTE_TAR="/tmp/lw-new-$STAMP.tar"
ssh -o BatchMode=yes "$NAS" "cat > $REMOTE_TAR" < "$TAR"

ssh -o BatchMode=yes "$NAS" "bash -s" -- "$DIR" "$NAME" "$PORT" "$VERSION" "$STAMP" "$REMOTE_TAR" <<'REMOTE'
export PATH=/usr/local/bin:$PATH
DIR=$1; NAME=$2; PORT=$3; VERSION=$4; STAMP=$5; NEWTAR=$6
D="sudo -n docker"; DC="sudo -n docker-compose"
# Root-side file work in a throwaway container (the SSH user cannot touch files owned by another UID).
asroot() { $D run --rm --user 0 -v "$DIR":/w -v "$NEWTAR":/new.tar:ro alpine:3 sh -c "$1"; }
cleanup() { rm -f "$NEWTAR"; }
trap cleanup EXIT

fail=0
backup="src-vor-$VERSION-$STAMP.tar"
had_image=0
if $D image inspect "$NAME:latest" >/dev/null 2>&1; then $D tag "$NAME:latest" "$NAME:rollback" && had_image=1; fi
asroot "cd /w && tar -cf /w/$backup src" || { echo "backup failed, nothing changed"; exit 1; }
echo "backup: $DIR/$backup (image $NAME:rollback=$had_image)"

rollback() {
  echo "!! rolling back to the previous version"
  asroot "cd /w && rm -rf src.failed && mv src src.failed && mv src.old src && rm -rf src.failed" || echo "!! source restore failed, backup tar: $DIR/$backup"
  [ "$had_image" = 1 ] && $D tag "$NAME:rollback" "$NAME:latest"
  (cd "$DIR" && $DC up -d --force-recreate >/dev/null 2>&1) || echo "!! compose up failed during rollback"
  for i in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { echo "rollback done: old version answers /api/health"; return; }
    sleep 2
  done
  echo "!! rollback did not come up, check the container by hand; backup tar: $DIR/$backup"
}

# Swap source: new tree next to the old one, then two renames. A stray src.old/src.new from a crashed run is removed first.
asroot "cd /w && rm -rf src.new src.old && mkdir src.new && tar -x -C src.new -f /new.tar && chown -R 501:20 src.new && chmod -R a+rX src.new && chmod 777 src.new && mv src src.old && mv src.new src" \
  || { echo "!! unpack failed"; asroot "cd /w && [ -d src.old ] && [ ! -d src ] && mv src.old src; rm -rf src.new"; exit 1; }

if ! $D build -t "$NAME:latest" "$DIR/src" >/tmp/lw-build.log 2>&1; then
  echo "!! build failed (tail of log):"; tail -n 15 /tmp/lw-build.log; rm -f /tmp/lw-build.log
  rollback; exit 1
fi
rm -f /tmp/lw-build.log

if ! (cd "$DIR" && $DC up -d >/dev/null 2>&1); then echo "!! compose up failed"; rollback; exit 1; fi

ok=0
for i in $(seq 1 45); do
  v=$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  if [ "$v" = "$VERSION" ]; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then echo "!! /api/health did not report $VERSION (got: ${v:-nothing})"; rollback; exit 1; fi

h=starting
for i in $(seq 1 40); do
  h=$($D inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo unknown)
  [ "$h" = healthy ] && break
  [ "$h" = unhealthy ] && break
  sleep 3
done
if [ "$h" != healthy ]; then echo "!! container is $h"; rollback; exit 1; fi

asroot "cd /w && rm -rf src.old"
echo "ok: $NAME $VERSION live, container healthy, /api/health = $VERSION"
REMOTE
