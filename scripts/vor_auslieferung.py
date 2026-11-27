#!/usr/bin/env python3
"""Gate before a release: everything that ships must have been checked as a system.

    python3 scripts/vor_auslieferung.py [--no-ci] [--repo owner/name]

Checks, in this order (exit 0 and the line "VOR_AUSLIEFERUNG: GREEN" only if all pass):
  1. versions agree: package.json = desktop/Cargo.toml workspace version = top CHANGELOG section
     (with a date, not "unreleased")
  2. npm test (server, heuristics vectors, i18n of app and extension, download page, extension logic)
  3. the browser extension builds for all three targets (npm run build:extension: two zips + the Safari folder) and the generated desktop strings are current
  4. commit identities of all branches and tags (scripts/check_commit_identity.py --branches --tags)
  5. CI on GitHub is green for HEAD: workflows Desktop (builds + end-to-end tests on Windows, macOS,
     Linux), Android and Commit identity. A workflow that did not run for HEAD (path filter) must have
     its latest completed run on main green. A run of HEAD that is still queued or running is
     waited for (poll every 30 s, up to LINKWACHE_CI_WAIT_MIN minutes, default 45: Android takes
     9-12 min) instead of counting as red; only a finished run decides. Needs the GitHub CLI (`gh`),
     skipped with --no-ci.
  6. the latest PUBLISHED release carries a signed Android APK of its own version (checksum listed,
     signature and certificate valid, versionName = version): scripts/apk_nachweis.py verify latest.
     Every release must ship the APK, so a release without one blocks the next release until it
     is attached (scripts/apk_nachweis.py heal does that; a timer on the build host runs it).
     Skipped with --no-ci (needs GitHub and the Android build tools).
Exit 1 = a check failed, 2 = could not run a check.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ["Desktop", "Android", "Commit identity"]
CI_WAIT_MIN = float(os.environ.get("LINKWACHE_CI_WAIT_MIN", "45"))
CI_POLL_S = float(os.environ.get("LINKWACHE_CI_POLL_S", "30"))


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)


def step(name, ok, detail=""):
    print(("  OK  " if ok else "  RED ") + name + (f" — {detail}" if detail else ""), flush=True)
    return ok


def versions():
    pkg = json.loads((ROOT / "package.json").read_text())["version"]
    cargo = re.search(r'^version = "([^"]+)"', (ROOT / "desktop/Cargo.toml").read_text(), re.M)
    head = re.search(r"^## (\d+\.\d+\.\d+) — (.+)$", (ROOT / "CHANGELOG.md").read_text(), re.M)
    cargo = cargo.group(1) if cargo else None
    ok = bool(head) and pkg == cargo == head.group(1) and re.match(r"^\d{4}-\d\d-\d\d$", head.group(2).strip())
    return step("versions", bool(ok), f"package.json {pkg}, Cargo {cargo}, CHANGELOG {head.group(0)[3:] if head else '?'}"), pkg


def head_runs(repo, sha):
    r = run(["gh", "api", f"repos/{repo}/actions/runs?head_sha={sha}&per_page=100"])
    if r.returncode:
        print("  cannot query GitHub:", r.stderr.strip()[:200])
        sys.exit(2)
    return json.loads(r.stdout).get("workflow_runs", [])


def unfinished(runs):
    """Latest push run per gated workflow that has not completed yet."""
    out = []
    for wf in WORKFLOWS:
        mine = [x for x in runs if x["name"] == wf and x["event"] == "push"]
        if mine:
            x = max(mine, key=lambda x: x["run_number"])
            if x["status"] != "completed":
                out.append(x)
    return out


def wait_for_runs(repo, sha, runs, wait_min=None, poll_s=None, now=time.monotonic, sleep=time.sleep):
    """Wait while a run of HEAD is queued or in progress. Progress, not the clock, decides:
    the deadline only guards against a run that never finishes (default 45 min, far above the
    9-12 min of the slowest workflow). Returns the freshest run list."""
    wait_min = CI_WAIT_MIN if wait_min is None else wait_min
    poll_s = CI_POLL_S if poll_s is None else poll_s
    deadline = now() + wait_min * 60
    pending = unfinished(runs)
    while pending and now() < deadline:
        print("  ...  waiting for " + ", ".join(f"{x['name']} ({x['status']})" for x in pending), flush=True)
        sleep(poll_s)
        runs = head_runs(repo, sha)
        pending = unfinished(runs)
    return runs


def ci(repo):
    sha = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    runs = wait_for_runs(repo, sha, head_runs(repo, sha))
    good = True
    for wf in WORKFLOWS:
        mine = [x for x in runs if x["name"] == wf and x["event"] == "push"]
        if mine:
            x = max(mine, key=lambda x: x["run_number"])
            good &= step(f"CI {wf} @ {sha[:8]}", x["status"] == "completed" and x["conclusion"] == "success",
                         f"{x['status']}/{x['conclusion']} {x['html_url']}")
            continue
        r = run(["gh", "api", f"repos/{repo}/actions/runs?branch=main&status=completed&per_page=50"])
        last = [x for x in json.loads(r.stdout or "{}").get("workflow_runs", []) if x["name"] == wf]
        if not last:
            good &= step(f"CI {wf}", False, "no run for HEAD and none on main")
            continue
        x = last[0]
        good &= step(f"CI {wf} (not triggered by HEAD; latest on main)", x["conclusion"] == "success",
                     f"{x['conclusion']} {x['html_url']}")
    return good


def apk_of_latest(repo):
    r = run([sys.executable, "scripts/apk_nachweis.py", "verify", "latest", "--repo", repo])
    lines = [l.strip() for l in r.stdout.splitlines() if l.strip()]
    red = [l for l in lines if l.startswith("RED")]
    head = lines[0].lstrip("= ") if lines else "no output"
    return step("latest release carries a valid Android APK of its own version", r.returncode == 0,
                head if r.returncode == 0 else (red[0][3:].strip() if red else (r.stderr.strip()[-200:] or head)))


def main():
    args = sys.argv[1:]
    repo = args[args.index("--repo") + 1] if "--repo" in args else "robeertm/linkwache"
    print("== Linkwache: gate before release")
    ok, version = versions()
    t = run(["npm", "test", "--silent"])
    tail = [l for l in t.stdout.splitlines() if l.startswith("ℹ ")]
    ok &= step("npm test", t.returncode == 0, " ".join(tail[:3]))
    b = run(["npm", "run", "--silent", "build:extension"])
    zips = sorted(p.name for p in (ROOT / "extension/dist").glob(f"*-{version}.zip")) if b.returncode == 0 else []
    safari = (ROOT / "extension/dist/safari/manifest.json").is_file() and (ROOT / "extension/dist/safari-app-strings.json").is_file()
    ok &= step("extension build", b.returncode == 0 and len(zips) == 2 and safari,
               (", ".join(zips) + (" + safari folder" if safari else " — safari folder missing")) if zips else b.stderr.strip()[-200:])
    gen = run(["node", "desktop/scripts/i18n.mjs"])
    diff = run(["git", "status", "--porcelain", "desktop/ui"])
    ok &= step("desktop strings generated and committed", gen.returncode == 0 and not diff.stdout.strip(), diff.stdout.strip()[:200])
    ident = run([sys.executable, "scripts/check_commit_identity.py", "--branches", "--tags"])
    ok &= step("commit identities", ident.returncode == 0, (ident.stdout + ident.stderr).strip().splitlines()[-1:][0] if (ident.stdout + ident.stderr).strip() else "")
    dirty = run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip()
    ok &= step("working tree clean (the release ships HEAD)", not dirty, dirty[:200])
    if "--no-ci" in args:
        print("  (CI check and APK check skipped)")
    else:
        ok &= ci(repo)
        ok &= apk_of_latest(repo)
    print("VOR_AUSLIEFERUNG: " + ("GREEN" if ok else "RED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
