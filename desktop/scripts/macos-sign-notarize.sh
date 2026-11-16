#!/usr/bin/env bash
# macOS signing + notarisation on the maintainer's Mac (the Apple Developer ID never leaves
# the Mac; the updater key never comes to the Mac). Run after CI attached the unsigned
# macOS files to the pre-release <tag>:
#
#   MAC_SIGN_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" \
#   NOTARY_PROFILE=<notarytool keychain profile> \
#   desktop/scripts/macos-sign-notarize.sh v0.5.0
#
# Steps: download the universal .app tarball → codesign (hardened runtime, timestamp) →
# notarytool submit --wait → stapler → new DMG (signed, notarised, stapled) + new updater
# tarball → gh release upload --clobber → start the workflow that re-signs the tarball with the
# updater key and rewrites latest.json + SHA256SUMS.txt.
set -euo pipefail
tag="${1:?usage: macos-sign-notarize.sh <tag>}"
: "${MAC_SIGN_IDENTITY:?set MAC_SIGN_IDENTITY}"
: "${NOTARY_PROFILE:?set NOTARY_PROFILE (xcrun notarytool store-credentials)}"
repo="${REPO:-robeertm/linkwache}"
version="${tag#v}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

tarball="Linkwache_${version}_universal.app.tar.gz"
dmg="Linkwache_${version}_universal.dmg"
gh release download "$tag" -R "$repo" -p "$tarball"
tar -xzf "$tarball"
test -d Linkwache.app

echo "== codesign"
codesign --force --deep --options runtime --timestamp --sign "$MAC_SIGN_IDENTITY" Linkwache.app
codesign --verify --deep --strict --verbose=2 Linkwache.app

echo "== notarise the app"
ditto -c -k --keepParent Linkwache.app Linkwache.zip
xcrun notarytool submit Linkwache.zip --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple Linkwache.app
spctl --assess --type execute --verbose Linkwache.app

echo "== DMG"
mkdir dmgroot
cp -R Linkwache.app dmgroot/
ln -s /Applications dmgroot/Applications
hdiutil create -volname Linkwache -srcfolder dmgroot -ov -format UDZO "$dmg"
codesign --force --timestamp --sign "$MAC_SIGN_IDENTITY" "$dmg"
xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$dmg"

echo "== updater tarball (signature is added by the re-sign workflow)"
rm -f "$tarball"
COPYFILE_DISABLE=1 tar -czf "$tarball" Linkwache.app

gh release upload "$tag" -R "$repo" "$dmg" "$tarball" --clobber
gh workflow run desktop-mac-resign.yml -R "$repo" -f tag="$tag"
echo "Uploaded. The workflow 'Desktop macOS re-sign' now signs $tarball for the updater and rewrites latest.json."
