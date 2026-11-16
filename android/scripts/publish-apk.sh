#!/usr/bin/env bash
# Attaches the signed Android APK to an EXISTING GitHub release (the release and its tag are
# created by the maintainer's release process — this script never creates tags or releases).
#
#   LINKWACHE_SIGNING_DIR=… APKSIGNER_JAR=… android/scripts/publish-apk.sh v0.5.0
#   (key readable only by root: SIGN_PREFIX="sudo env LINKWACHE_SIGNING_DIR=… APKSIGNER_JAR=…";
#    run the script itself as the user that is logged in to gh)
#
# Gate: the "Android" workflow run for the tag's commit must have succeeded (unit tests, lint,
# emulator end-to-end test). Its unsigned APK is signed with sign-release.sh, uploaded, and the
# digest GitHub reports for the asset is compared with the local SHA-256.
set -euo pipefail
TAG=${1:?tag, e.g. v0.5.0}
REPO=${REPO:-robeertm/linkwache}
V=${TAG#v}
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/lw-apk.XXXXXX")
trap 'rm -rf "$work"' EXIT

gh release view "$TAG" -R "$REPO" --json tagName >/dev/null || { echo "release $TAG does not exist (create it first)" >&2; exit 2; }
sha=$(gh api "repos/$REPO/commits/$TAG" -q .sha)
run=$(gh run list -R "$REPO" --workflow Android --commit "$sha" --json databaseId,conclusion,event \
      -q '[.[] | select(.conclusion=="success")][0].databaseId')
[ -n "$run" ] && [ "$run" != null ] || { echo "no successful Android workflow run for $TAG ($sha) — gate not green" >&2; exit 3; }
echo "gate: Android run $run succeeded for $sha"

gh run download "$run" -R "$REPO" -n android-apks -D "$work/in"
${SIGN_PREFIX:-} "$here/sign-release.sh" "$work/in/Linkwache-android-$V-unsigned.apk" "$work/out"
apk="$work/out/Linkwache-android-$V.apk"
local_sha=$(cut -d' ' -f1 "$apk.sha256")

existing=$(gh api "repos/$REPO/releases/tags/$TAG" -q ".assets[] | select(.name==\"Linkwache-android-$V.apk\") | .digest" || true)
if [ -n "$existing" ]; then
  echo "asset already attached ($existing) — nothing uploaded"
  exit 0
fi
gh release upload "$TAG" -R "$REPO" "$apk"
remote=$(gh api "repos/$REPO/releases/tags/$TAG" -q ".assets[] | select(.name==\"Linkwache-android-$V.apk\") | .digest")
[ "$remote" = "sha256:$local_sha" ] || { echo "digest mismatch after upload: $remote vs $local_sha" >&2; exit 4; }
echo "attached Linkwache-android-$V.apk  sha256 $local_sha"
