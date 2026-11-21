#!/usr/bin/env python3
"""Every Linkwache release carries a signed Android APK of its own version.

    python3 scripts/apk_nachweis.py verify [TAG|latest] [--repo owner/name]
    python3 scripts/apk_nachweis.py heal   [TAG|latest|recent] [--repo owner/name]

verify  Checks the PUBLISHED release (what users download), exit 0 only if all hold:
          1. the release has the asset Linkwache-android-<version>.apk (version = tag)
          2. SHA256SUMS.txt lists it and the digest matches the asset
          3. apksigner verifies the signature (v2/v3, min SDK 26) and the certificate is the
             published Linkwache certificate (docs/ANDROID.md)
          4. versionName in the APK manifest = release version, versionCode = the app's rule
             (major*10000 + minor*100 + patch, see android/app/build.gradle.kts)
heal    Runs verify; if the APK is missing, signs the unsigned APK of the tag's green Android CI
        run (android/scripts/publish-apk.sh), rewrites SHA256SUMS and verifies again.
        "recent" = the 3 newest releases. Exit 0 = every checked release is fine,
        1 = a release is still without a valid APK, 3 = the Android CI run is not done yet
        (try again later).

Needs the GitHub CLI (logged in), java and apksigner.jar (APKSIGNER_JAR). Signing for heal uses
the same variables as publish-apk.sh (SIGN_PREFIX, LINKWACHE_SIGNING_DIR). Nothing here
creates tags or releases, and no key is ever printed.
"""
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# SHA-256 of the published signing certificate (same value as in android/scripts/sign-release.sh).
EXPECTED_CERT = "24a4b8a1b18eba7e7deb803b7c193648af019983960be7809cb0b23918709502"


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, **kw)


def gh_json(repo, path):
    r = sh(["gh", "api", f"repos/{repo}/{path}"])
    if r.returncode:
        raise RuntimeError(f"gh api {path}: {r.stderr.strip()[:200]}")
    return json.loads(r.stdout)


def version_code(v):
    a, b, c = (int(x) for x in v.split("."))
    return a * 10000 + b * 100 + c


def manifest_attrs(apk):
    """versionName / versionCode of the binary AndroidManifest.xml (no Android SDK needed)."""
    with zipfile.ZipFile(apk) as z:
        data = z.read("AndroidManifest.xml")
    off = struct.unpack_from("<H", data, 2)[0]  # header size of the XML chunk
    strings = []
    pos = off
    while pos + 8 <= len(data):
        ctype, hsize, size = struct.unpack_from("<HHI", data, pos)
        if ctype == 0x0001:  # string pool
            count, _styles, flags, s_start = struct.unpack_from("<IIII", data, pos + 8)
            utf8 = bool(flags & 0x100)
            offs = struct.unpack_from(f"<{count}I", data, pos + hsize)
            base = pos + s_start
            for o in offs:
                p = base + o
                if utf8:
                    n = data[p]; p += 1 if n < 0x80 else 2
                    n = data[p]; p += 1
                    if n & 0x80:
                        n = ((n & 0x7F) << 8) | data[p]; p += 1
                    strings.append(data[p:p + n].decode("utf-8", "replace"))
                else:
                    n = struct.unpack_from("<H", data, p)[0]; p += 2
                    if n & 0x8000:
                        n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", data, p)[0]; p += 2
                    strings.append(data[p:p + 2 * n].decode("utf-16-le", "replace"))
        elif ctype == 0x0102:  # start element
            ns, name_i = struct.unpack_from("<ii", data, pos + 16)[0:2]
            attr_start, attr_size, attr_count = struct.unpack_from("<HHH", data, pos + 24)
            if strings[name_i] == "manifest":
                out = {}
                for i in range(attr_count):
                    a = pos + 16 + attr_start + i * attr_size
                    _ans, aname, raw, _vsize, _res0, vtype, vdata = struct.unpack_from("<iiiHBBI", data, a)
                    key = strings[aname]
                    if key == "versionName":
                        out[key] = strings[raw] if raw >= 0 else None
                    elif key == "versionCode":
                        out[key] = vdata
                    elif key == "package":
                        out[key] = strings[raw] if raw >= 0 else None
                return out
        pos += size
    return {}


def step(name, ok, detail=""):
    print(("  OK  " if ok else "  RED ") + name + (f" — {detail}" if detail else ""), flush=True)
    return ok


def verify(repo, tag):
    """True if the published release `tag` carries a valid APK of its own version."""
    try:
        rel = gh_json(repo, f"releases/tags/{tag}")
    except RuntimeError as e:
        return step(f"release {tag}", False, str(e))
    m = re.fullmatch(r"v(\d+\.\d+\.\d+)", tag)
    if not m:
        return step(f"release {tag}", False, "tag is not vX.Y.Z")
    v = m.group(1)
    want = f"Linkwache-android-{v}.apk"
    print(f"== {tag}: Android APK")
    assets = {a["name"]: a for a in rel.get("assets", [])}
    foreign = [n for n in assets if n.endswith(".apk") and n != want]
    if not step(f"asset {want}", want in assets, "missing" if want not in assets else
                f"{assets[want]['size']} bytes" + (f"; foreign APK files: {foreign}" if foreign else "")):
        return False
    digest = (assets[want].get("digest") or "").removeprefix("sha256:")
    with tempfile.TemporaryDirectory(prefix="lw-apkcheck.") as d:
        r = sh(["gh", "release", "download", tag, "-R", repo, "-p", want, "-p", "SHA256SUMS.txt", "-D", d])
        if r.returncode:
            return step("download", False, r.stderr.strip()[:200])
        apk = Path(d) / want
        local = hashlib.sha256(apk.read_bytes()).hexdigest()
        ok = step("digest of the asset = file", not digest or digest == local, local[:12] + "…")
        sums = {}
        sp = Path(d) / "SHA256SUMS.txt"
        if sp.is_file():
            for line in sp.read_text().splitlines():
                p = line.split(None, 1)
                if len(p) == 2:
                    sums[p[1].strip().lstrip("*")] = p[0]
        ok &= step("SHA256SUMS.txt lists the APK with this digest", sums.get(want) == local,
                   "not listed" if want not in sums else ("match" if sums[want] == local else "digest differs"))
        jar = os.environ.get("APKSIGNER_JAR", "/opt/android-signing/apksigner-35.0.0.jar")
        vr = sh(["java", "-jar", jar, "verify", "--min-sdk-version", "26", "--print-certs", str(apk)])
        cert = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F:]+)", vr.stdout)
        cert = cert.group(1).replace(":", "").lower() if cert else ""
        ok &= step("apksigner verify (v2/v3, minSdk 26)", vr.returncode == 0, (vr.stderr or vr.stdout).strip()[:160] if vr.returncode else "valid")
        ok &= step("signed with the published certificate", cert == EXPECTED_CERT, cert[:12] + "…" if cert else "no certificate")
        try:
            a = manifest_attrs(apk)
        except Exception as e:  # corrupt zip / manifest
            a = {}
            print("       manifest unreadable:", e)
        ok &= step("versionName = release version", a.get("versionName") == v, f"{a.get('versionName')} vs {v}")
        ok &= step("versionCode follows the app rule", a.get("versionCode") == version_code(v),
                   f"{a.get('versionCode')} vs {version_code(v)}")
        return bool(ok)


def heal(repo, tag):
    if verify(repo, tag):
        return 0
    rel = gh_json(repo, f"releases/tags/{tag}")
    v = tag[1:]
    if f"Linkwache-android-{v}.apk" in {a["name"] for a in rel.get("assets", [])}:
        print("  an APK of this version exists but is not valid — not overwritten, needs a human")
        return 1
    if rel.get("draft"):
        return 0
    sha = gh_json(repo, f"commits/{tag}")["sha"]
    runs = gh_json(repo, f"actions/runs?head_sha={sha}&per_page=100")["workflow_runs"]
    android = [x for x in runs if x["name"] == "Android" and x["event"] == "push"]
    if not any(x["conclusion"] == "success" for x in android):
        pending = [x for x in android if x["status"] != "completed"]
        print("  Android CI for", tag, "is not green yet" + (" (still running)" if pending else " (no run / failed)"))
        return 3 if pending or not android else 1
    for attempt in range(3):  # the artefact download from GitHub sometimes times out; the attach itself is idempotent
        r = subprocess.run([str(ROOT / "android/scripts/publish-apk.sh"), tag], env={**os.environ, "REPO": repo}, cwd=ROOT)
        if r.returncode == 0:
            break
        print(f"  attach attempt {attempt + 1}/3 failed (exit {r.returncode})", flush=True)
        if attempt < 2:
            time.sleep(20)
    else:
        return 1
    r = subprocess.run([str(ROOT / "desktop/scripts/sha256sums.sh"), tag], env={**os.environ, "GITHUB_REPOSITORY": repo},
                       cwd=ROOT, stdout=subprocess.DEVNULL)
    if r.returncode:
        return 1
    return 0 if verify(repo, tag) else 1


def main():
    args = sys.argv[1:]
    repo = args[args.index("--repo") + 1] if "--repo" in args else os.environ.get("REPO", "robeertm/linkwache")
    pos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--repo")]
    if not pos or pos[0] not in ("verify", "heal"):
        sys.exit(__doc__)
    cmd, target = pos[0], (pos[1] if len(pos) > 1 else "latest")
    if target == "recent":
        rels = gh_json(repo, "releases?per_page=3")
        tags = [r["tag_name"] for r in rels if not r.get("draft") and not r.get("prerelease")]
    elif target == "latest":
        tags = [gh_json(repo, "releases/latest")["tag_name"]]
    else:
        tags = [target]
    rcs = [(0 if verify(repo, t) else 1) if cmd == "verify" else heal(repo, t) for t in tags]
    worst = 1 if 1 in rcs else (3 if 3 in rcs else 0)
    if cmd == "verify":
        print("APK_NACHWEIS: " + ("GREEN" if worst == 0 else "RED"))
    sys.exit(worst)


if __name__ == "__main__":
    main()
