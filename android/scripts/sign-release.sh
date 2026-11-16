#!/usr/bin/env bash
# Signs the unsigned release APK built by CI (.github/workflows/android.yml) on the
# maintainer's build host. The signing key never leaves that host and never reaches CI.
#
#   LINKWACHE_SIGNING_DIR=<dir with release.p12 and password> APKSIGNER_JAR=<apksigner.jar> \
#     android/scripts/sign-release.sh <Linkwache-android-X.Y.Z-unsigned.apk> <out dir>
#
# Writes <out dir>/Linkwache-android-X.Y.Z.apk and <out dir>/Linkwache-android-X.Y.Z.apk.sha256.
# Refuses to sign when the input is not zip-aligned, when its checksum file does not match,
# or when the resulting certificate is not the published Linkwache certificate.
set -euo pipefail

# SHA-256 of the Linkwache Android signing certificate (public; see docs/ANDROID.md).
EXPECTED_CERT=24a4b8a1b18eba7e7deb803b7c193648af019983960be7809cb0b23918709502

IN=${1:?unsigned apk}
OUT=${2:?out dir}
KEYDIR=${LINKWACHE_SIGNING_DIR:?set LINKWACHE_SIGNING_DIR}
JAR=${APKSIGNER_JAR:?set APKSIGNER_JAR}
name=$(basename "$IN")
[[ $name =~ ^Linkwache-android-([0-9]+\.[0-9]+\.[0-9]+)-unsigned\.apk$ ]] || { echo "unexpected file name: $name" >&2; exit 2; }
V=${BASH_REMATCH[1]}

if [ -f "$IN.sha256" ]; then
  (cd "$(dirname "$IN")" && sha256sum -c --quiet "$name.sha256") || { echo "checksum of the CI artefact does not match" >&2; exit 3; }
fi

# Stored entries must be 4-byte aligned (native libraries: page aligned) before v2/v3 signing.
python3 - "$IN" <<'PY'
import struct, sys, zipfile
path = sys.argv[1]
bad = []
with open(path, "rb") as fh, zipfile.ZipFile(path) as z:
    for i in z.infolist():
        if i.compress_type != zipfile.ZIP_STORED:
            continue
        fh.seek(i.header_offset)
        h = fh.read(30)
        n, m = struct.unpack("<HH", h[26:30])
        data = i.header_offset + 30 + n + m
        need = 4096 if i.filename.endswith(".so") else 4
        if data % need:
            bad.append(i.filename)
if bad:
    sys.exit("not zip-aligned: " + ", ".join(bad[:5]))
PY

mkdir -p "$OUT"
DST="$OUT/Linkwache-android-$V.apk"
java -jar "$JAR" sign \
  --ks "$KEYDIR/release.p12" --ks-type PKCS12 --ks-key-alias linkwache \
  --ks-pass "file:$KEYDIR/password" \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out "$DST" "$IN"

CERT=$(java -jar "$JAR" verify --print-certs "$DST" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | tr -d ' :' | tr 'A-F' 'a-f')
java -jar "$JAR" verify --min-sdk-version 26 "$DST"
if [ "$CERT" != "$EXPECTED_CERT" ]; then
  rm -f "$DST"
  echo "signed with an unexpected certificate ($CERT)" >&2
  exit 4
fi
(cd "$OUT" && sha256sum "Linkwache-android-$V.apk" > "Linkwache-android-$V.apk.sha256")
echo "signed: $DST"
echo "certificate: $CERT"
cat "$OUT/Linkwache-android-$V.apk.sha256"
