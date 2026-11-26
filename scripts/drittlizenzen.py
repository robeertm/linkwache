#!/usr/bin/env python3
"""Writes THIRD-PARTY-NOTICES.md: every third-party component with its licence.

Sources (all read from the repository's lock and build files):
  1. package-lock.json         npm packages of the server / Worker (production only)
  2. desktop/Cargo.lock        Rust crates of the desktop app (Tauri)
  3. android/**/build.gradle.kts   Android libraries (direct, non-test dependencies)
  4. the browser extension and the Safari app ship no third-party code (the
     build only bundles the project's own sources) - stated in the file.

Licence names and texts come from the real packages: the npm lock carries the
SPDX name per package and `npm ci` provides the licence files; every crate is
downloaded once from static.crates.io (the crates.io download host) and its
Cargo.toml and licence files are read. Gradle libraries use the curated table
below (a build fails loudly when a library is not in it).

Usage (everything goes to a throwaway work directory, nothing is installed
into the repository or a shared environment):

    python3 -I scripts/drittlizenzen.py --work /tmp/lw-notices > THIRD-PARTY-NOTICES.md

test/third-party-notices.test.js fails when a dependency of the lists above
is missing in THIRD-PARTY-NOTICES.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tomllib
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LICENCE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)", re.I)

# Direct Android libraries (group:artifact) -> (licence, holder). Transitive
# AndroidX / Kotlin / Okio libraries are covered by the umbrella entry below.
GRADLE_LIZENZEN = {
    "com.squareup.okhttp3:okhttp": ("Apache-2.0", "Square, Inc."),
    "androidx.core:core-ktx": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.activity:activity-compose": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.lifecycle:lifecycle-runtime-ktx": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.browser:browser": ("Apache-2.0", "The Android Open Source Project"),
    "org.jetbrains.kotlinx:kotlinx-coroutines-android": ("Apache-2.0", "JetBrains s.r.o. and Kotlin Programming Language contributors"),
    "androidx.compose:compose-bom": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.compose.ui:ui": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.compose.material3:material3": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.compose.material:material-icons-core": ("Apache-2.0", "The Android Open Source Project"),
    "androidx.compose.ui:ui-tooling-preview": ("Apache-2.0", "The Android Open Source Project"),
}
APACHE_FILE = Path("/usr/share/common-licenses/Apache-2.0")

# Standard texts for crates/packages that carry only an SPDX name.
SPDX_MIT = """MIT License

Copyright (c) {holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

SPDX_BSD3 = """BSD 3-Clause License

Copyright (c) {holder}
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."""
MPL_FILE = Path("/usr/share/common-licenses/MPL-2.0")


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _read(path: Path) -> str:
    return path.read_bytes().decode("utf-8", errors="replace").strip()


# ---------------------------------------------------------------- npm
def npm_entries(work: Path) -> list[dict]:
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    out = []
    for key, meta in sorted(lock["packages"].items()):
        if not key or meta.get("dev"):
            continue
        name = key.split("node_modules/")[-1]
        out.append({"name": name, "version": meta["version"], "license": meta.get("license") or "see licence file",
                    "key": key})
    # npm ci into the work dir to read licence files (production only, no scripts)
    dest = work / "npm"
    if not (dest / "node_modules").is_dir():
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "package.json", dest / "package.json")
        shutil.copy(ROOT / "package-lock.json", dest / "package-lock.json")
        subprocess.run(["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=dest, check=True, stdout=subprocess.DEVNULL)
    for e in out:
        folder = dest / e["key"]
        e["texts"] = [(f.name, _read(f)) for f in sorted(folder.iterdir())
                      if f.is_file() and LICENCE_FILE.match(f.name)] if folder.is_dir() else []
    return out


# ---------------------------------------------------------------- cargo
def _fetch_crate(work: Path, name: str, version: str) -> Path:
    dest = work / "crates" / f"{name}-{version}.crate"
    if not dest.exists():
        url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        req = urllib.request.Request(url, headers={"User-Agent": "linkwache-notices-generator"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                break
            except Exception:  # noqa: BLE001
                if attempt == 3:
                    raise
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return dest


def cargo_entries(work: Path) -> list[dict]:
    lock = tomllib.loads((ROOT / "desktop" / "Cargo.lock").read_text(encoding="utf-8"))
    pkgs = [p for p in lock["package"] if str(p.get("source", "")).startswith("registry+")]
    with ThreadPoolExecutor(max_workers=4) as pool:
        files = list(pool.map(lambda p: _fetch_crate(work, p["name"], p["version"]), pkgs))
    out = []
    for p, f in zip(pkgs, files):
        with tarfile.open(f) as tar:
            root = f"{p['name']}-{p['version']}"
            manifest = tomllib.loads(tar.extractfile(f"{root}/Cargo.toml").read().decode("utf-8", "replace"))
            info = manifest.get("package", {})
            texts = []
            for m in tar.getmembers():
                parts = m.name.split("/")
                if not m.isfile() or len(parts) != 2 or not LICENCE_FILE.match(parts[1]):
                    continue
                texts.append((parts[1], tar.extractfile(m).read().decode("utf-8", "replace").strip()))
        lic = info.get("license") or ("see " + info["license-file"] if info.get("license-file") else "see licence file")
        out.append({"name": p["name"], "version": p["version"], "license": lic,
                    "authors": [re.sub(r"\s*<.*?>", "", a) for a in info.get("authors", [])],
                    "repo": info.get("repository") or "", "texts": [t for t in texts if t[1]]})
    return out


# ---------------------------------------------------------------- gradle
def gradle_entries() -> list[dict]:
    seen = {}
    for f in sorted((ROOT / "android").rglob("build.gradle.kts")):
        for m in re.finditer(r'^\s*(implementation|api)\((?:platform\()?"([^":]+):([^":]+)(?::([^"]+))?"\)?\)', f.read_text(encoding="utf-8"), re.M):
            ga = f"{m.group(2)}:{m.group(3)}"
            version = m.group(4) or "(version from the BOM)"
            if ga not in GRADLE_LIZENZEN:
                sys.exit(f"{ga} is not in GRADLE_LIZENZEN - add its licence")
            seen[ga] = version if ga not in seen or m.group(4) else seen[ga]
    return [{"name": ga, "version": v, "license": GRADLE_LIZENZEN[ga][0], "holder": GRADLE_LIZENZEN[ga][1]}
            for ga, v in sorted(seen.items())]


# ---------------------------------------------------------------- output
HEAD = """# Third-party notices

Linkwache is built on the work of others. This file lists the third-party
components that are part of Linkwache - the server (`package-lock.json`), the
desktop app (`desktop/Cargo.lock`) and the Android app (`android/**/build.gradle.kts`) -
with their licences. Linkwache's own licence is in [LICENSE](LICENSE); it does not
limit the rights these licences grant for their components.

The file is generated by `scripts/drittlizenzen.py` and checked by
`test/third-party-notices.test.js`. The browser extension (`extension/`) and the
Safari app (`safari/`) contain no third-party code: the build bundles only the
project's own sources, and the Safari app uses only the system frameworks.

"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/linkwache-notices", help="throwaway work directory")
    work = Path(ap.parse_args().work)
    work.mkdir(parents=True, exist_ok=True)

    npm, crates, gradle = npm_entries(work), cargo_entries(work), gradle_entries()
    texts: dict[str, tuple[str, list[str]]] = {}

    def add(text: str, who: str) -> None:
        texts.setdefault(hashlib.sha256(text.encode()).hexdigest(), (text, []))[1].append(who)

    out = [HEAD, "## Server (npm packages)\n\nProduction dependencies of `package-lock.json`, including "
           "transitive ones. The same code runs as a Cloudflare Worker and in the container.\n\n"]
    for e in npm:
        out.append(f"- `{e['name']}` {e['version']} - {e['license']}\n")
        for _, t in e["texts"]:
            add(t, f"{e['name']} {e['version']}")

    out.append("\n## Desktop app (Rust crates)\n\nAll registry crates of `desktop/Cargo.lock` (a superset: "
               "which crates end up in a build depends on the platform). The licence texts "
               "follow in the last section.\n\n")
    nofile = []
    for e in crates:
        out.append(f"- `{e['name']}` {e['version']} - {e['license']}\n")
        for _, t in e["texts"]:
            add(t, f"{e['name']} {e['version']}")
        if not e["texts"]:
            nofile.append(e)

    out.append("\n## Android app (Gradle libraries)\n\nDirect, non-test dependencies of `android/app` and "
               "`android/core`. Their transitive AndroidX, Kotlin and Okio libraries are licensed under "
               "the Apache License 2.0 as well.\n\n")
    for e in gradle:
        out.append(f"- `{e['name']}` {e['version']} - {e['license']}, Copyright (c) {e['holder']}\n")
    if APACHE_FILE.exists():
        add(_read(APACHE_FILE), "Android libraries (Apache License 2.0, standard text)")

    if nofile:
        out.append("\n## Crates without a licence file of their own\n\nThese crates declare their licence only "
                   "in their package metadata; copyright belongs to the authors named here.\n\n")
        for e in nofile:
            holder = ", ".join(e["authors"]) or f"the {e['name']} authors"
            out.append(f"- `{e['name']}` {e['version']} - {e['license']} - Copyright (c) {holder}\n")
            tokens = set(re.findall(r"[A-Za-z0-9.+-]+", e["license"]))
            who = f"{e['name']} {e['version']}"
            if "MIT" in tokens:
                add(SPDX_MIT.format(holder=holder), who + " (standard MIT text)")
            elif "BSD-3-Clause" in tokens:
                add(SPDX_BSD3.format(holder=holder), who + " (standard BSD-3-Clause text)")
            elif "MPL-2.0" in tokens:
                add(_read(MPL_FILE), who + " (standard MPL-2.0 text)")
                out.append("  (MPL-2.0: used unmodified, source code at the crate's page on crates.io)\n")
            if "Apache-2.0" in tokens and "MIT" not in tokens:
                add(_read(APACHE_FILE), who + " (standard Apache-2.0 text)")
            if not tokens & {"MIT", "BSD-3-Clause", "MPL-2.0", "Apache-2.0"}:
                sys.exit(f"{who}: no standard text for {e['license']} - extend the script")
        out.append("\nFor crates offered under several licences, the permissive choice (MIT or "
                   "Apache-2.0) applies.\n")

    out.append("\n## Licence texts\n")
    for text, who in sorted(texts.values(), key=lambda t: (sorted(t[1])[0], t[0])):
        out.append("\n---\n\nUsed by: " + ", ".join(sorted(set(who))) + "\n\n```text\n" + text + "\n```\n")
    sys.stdout.write("".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
