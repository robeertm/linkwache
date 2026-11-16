#!/usr/bin/env python3
"""Gate before a release: everything that ships must have been checked as a system.

    python3 scripts/vor_auslieferung.py [--no-ci] [--repo owner/name]

Checks, in this order (exit 0 and the line "VOR_AUSLIEFERUNG: GREEN" only if all pass):
  1. versions agree: package.json = desktop/Cargo.toml workspace version = top CHANGELOG section
     (with a date, not "unreleased")
  2. npm test (server, heuristics vectors, i18n of app and extension, download page, extension logic)
  3. the browser extension builds (npm run build:extension) and the generated desktop strings are current
  4. commit identities of all branches and tags (scripts/check_commit_identity.py --branches --tags)
  5. CI on GitHub is green for HEAD: workflows Desktop (builds + end-to-end tests on Windows, macOS,
     Linux), Android and Commit identity. A workflow that did not run for HEAD (path filter) must have
     its latest completed run on main green. Needs the GitHub CLI (`gh`), skipped with --no-ci.
Exit 1 = a check failed, 2 = could not run a check.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ["Desktop", "Android", "Commit identity"]


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


def ci(repo):
    sha = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    r = run(["gh", "api", f"repos/{repo}/actions/runs?head_sha={sha}&per_page=100"])
    if r.returncode:
        print("  cannot query GitHub:", r.stderr.strip()[:200])
        sys.exit(2)
    runs = json.loads(r.stdout).get("workflow_runs", [])
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
    ok &= step("extension build", b.returncode == 0 and len(zips) == 2, ", ".join(zips) or b.stderr.strip()[-200:])
    gen = run(["node", "desktop/scripts/i18n.mjs"])
    diff = run(["git", "status", "--porcelain", "desktop/ui"])
    ok &= step("desktop strings generated and committed", gen.returncode == 0 and not diff.stdout.strip(), diff.stdout.strip()[:200])
    ident = run([sys.executable, "scripts/check_commit_identity.py", "--branches", "--tags"])
    ok &= step("commit identities", ident.returncode == 0, (ident.stdout + ident.stderr).strip().splitlines()[-1:][0] if (ident.stdout + ident.stderr).strip() else "")
    dirty = run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip()
    ok &= step("working tree clean (the release ships HEAD)", not dirty, dirty[:200])
    if "--no-ci" in args:
        print("  (CI check skipped)")
    else:
        ok &= ci(repo)
    print("VOR_AUSLIEFERUNG: " + ("GREEN" if ok else "RED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
