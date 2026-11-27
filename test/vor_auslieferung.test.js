// The release gate waits for a CI run of HEAD that is still queued or running instead of counting it as red
// (scripts/vor_auslieferung.py, wait_for_runs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const py = (code) => spawnSync("python3", ["-I", "-c", code], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname });

const PRELUDE = `
import sys, importlib.util
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("va", "scripts/vor_auslieferung.py")
va = importlib.util.module_from_spec(spec); spec.loader.exec_module(va)
def r(name, status, n=1, conclusion=None):
    return {"name": name, "event": "push", "run_number": n, "status": status, "conclusion": conclusion, "html_url": "u"}
`;

test("a running Android run is waited for until it completes", () => {
  const out = py(PRELUDE + `
polls = [[r("Android", "in_progress")], [r("Android", "completed", conclusion="success")]]
va.head_runs = lambda repo, sha: polls.pop(0)
clock = [0.0]
slept = []
res = va.wait_for_runs("o/r", "abc", [r("Android", "queued"), r("Commit identity", "completed", conclusion="success")],
                       wait_min=45, poll_s=30, now=lambda: clock[0], sleep=lambda s: (slept.append(s), clock.__setitem__(0, clock[0] + s)))
print(res[0]["status"], len(slept))
`);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /completed 2/);
});

test("finished runs are not waited for", () => {
  const out = py(PRELUDE + `
va.head_runs = lambda repo, sha: (_ for _ in ()).throw(AssertionError("must not poll"))
res = va.wait_for_runs("o/r", "abc", [r("Android", "completed", conclusion="failure")], now=lambda: 0.0, sleep=lambda s: None)
print(res[0]["conclusion"])
`);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /failure/);
});

test("the deadline only guards against a run that never finishes", () => {
  const out = py(PRELUDE + `
va.head_runs = lambda repo, sha: [r("Android", "in_progress")]
clock = [0.0]
n = [0]
def sleep(s):
    n[0] += 1; clock[0] += s
res = va.wait_for_runs("o/r", "abc", [r("Android", "in_progress")], wait_min=1, poll_s=30, now=lambda: clock[0], sleep=sleep)
print(res[0]["status"], n[0])
`);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /in_progress 2/);
});

test("a workflow not triggered by HEAD is not waited for", () => {
  const out = py(PRELUDE + `
print(len(va.unfinished([r("Desktop", "completed", conclusion="success")])), len(va.unfinished([])))
`);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /0 0/);
});
