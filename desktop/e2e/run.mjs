#!/usr/bin/env node
// End-to-end test of the desktop app on a real system (docs/DESKTOP.md section 10).
// Registers Linkwache as the http/https handler, sets a fake "real browser" (records the URLs
// it receives) as forward target, starts the mock server, opens links through the OS and
// checks: green reaches the fake browser, red does not (until the deliberate second step),
// amber opens only after the delay, server down → "could not be checked" and nothing opens,
// mailto is never handled. Takes native screenshots of every state.
//
//   node desktop/e2e/run.mjs --app <linkwache binary built with --features e2e>
//        --out <dir> [--bundle Linkwache.app] [--fake <fake browser exe|.app>] [--shipped <release binary>]
//
// Linux: run inside `dbus-run-session`; an Xvfb display is started if DISPLAY is unset.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = "") => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PLATFORM = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const OUT = path.resolve(arg("--out", "e2e-out"));
const APP = path.resolve(arg("--app"));
const BUNDLE = arg("--bundle") ? path.resolve(arg("--bundle")) : "";
const FAKE_IN = arg("--fake") ? path.resolve(arg("--fake")) : "";
const SHIPPED = arg("--shipped") ? path.resolve(arg("--shipped")) : "";
const PORT = Number(arg("--port", "8787"));
const SERVER = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const STATE = path.join(OUT, "state.jsonl");
const CMD = path.join(OUT, "cmd.txt");
const FAKE_DIR = path.join(OUT, "fake");
fs.mkdirSync(FAKE_DIR, { recursive: true });
const FAKE_LOG = path.join(FAKE_DIR, "received.log");
const REQ_LOG = path.join(OUT, "requests.jsonl");
for (const f of [STATE, CMD, FAKE_LOG, REQ_LOG]) fs.writeFileSync(f, "");

const results = [];
const notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);
function record(name, ok, detail = "", required = true) {
  results.push({ name, ok, detail, required });
  log(ok ? "PASS" : required ? "FAIL" : "WARN", name, detail);
}

// ── Environment ──────────────────────────────────────────────────────────────
const env = { ...process.env, LINKWACHE_E2E_STATE_FILE: STATE, LINKWACHE_E2E_CMD_FILE: CMD };
delete env.BROWSER;
const children = [];

async function linuxEnv() {
  const home = path.join(OUT, "home");
  for (const d of [".config", ".local/share/applications", ".cache", ".mozilla", ".config/google-chrome"]) fs.mkdirSync(path.join(home, d), { recursive: true });
  Object.assign(env, {
    HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_CACHE_HOME: path.join(home, ".cache"), XDG_DATA_DIRS: "/usr/local/share:/usr/share",
  });
  delete env.XDG_CURRENT_DESKTOP;
  delete env.DESKTOP_SESSION;
  delete env.GNOME_DESKTOP_SESSION_ID;
  delete env.KDE_FULL_SESSION;
  if (!env.DISPLAY) {
    const disp = arg("--display", ":99");
    const x = spawn("Xvfb", [disp, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
    children.push(x);
    env.DISPLAY = disp;
    await sleep(1500);
    notes.push(`Xvfb ${disp} started by the test`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function states() {
  return fs.readFileSync(STATE, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
async function waitFor(pred, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
const waitState = (event, match = () => true, ms = 15000, after = 0) =>
  waitFor(() => states().slice(after).find((s) => s.event === event && match(s.data || {})), ms);
const received = () => fs.readFileSync(FAKE_LOG, "utf8").split(/\r?\n/).filter(Boolean);
function cmd(line) { fs.appendFileSync(CMD, line + "\n"); }

function run(file, args, opts = {}) {
  const r = spawnSync(file, args, { env, encoding: "utf8", timeout: 60000, ...opts });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" };
}
function cli(args) {
  const outFile = path.join(OUT, `cli-${args[0].replace(/^-+/, "")}.json`);
  const r = run(APP, [...args, "--out", outFile]);
  let json = null;
  try { json = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch { try { json = JSON.parse(r.stdout); } catch { /* none */ } }
  return { ...r, json };
}

function screenshot(name) {
  const file = path.join(SHOTS, `${name}.png`);
  try {
    if (PLATFORM === "linux") execFileSync("import", ["-window", "root", file], { env, timeout: 20000 });
    else if (PLATFORM === "macos") execFileSync("screencapture", ["-x", file], { timeout: 20000 });
    else {
      const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);$bmp.Save('${file.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`;
      execFileSync("powershell", ["-NoProfile", "-Command", ps], { timeout: 30000 });
    }
    log("screenshot", name);
  } catch (e) {
    notes.push(`screenshot ${name} failed: ${String(e.message).split("\n")[0]}`);
  }
}

let mock = null;
async function startMock() {
  mock = spawn(process.execPath, [path.join(here, "mock-server.mjs"), "--port", String(PORT), "--log", REQ_LOG], { stdio: "inherit", env: process.env });
  children.push(mock);
  const ok = await waitFor(() => { const r = spawnSync(process.execPath, ["-e", `fetch("${SERVER}/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`]); return r.status === 0; }, 15000, 300);
  if (!ok) throw new Error("mock server did not start");
}
async function stopMock() {
  if (!mock) return;
  mock.kill();
  await waitFor(() => mock.exitCode !== null || mock.signalCode !== null, 5000);
  mock = null;
}

let appProc = null;
function startApp(binary, extra = []) {
  const p = spawn(binary, extra, { env, stdio: ["ignore", "inherit", "inherit"], detached: false });
  children.push(p);
  appProc = p;
  return p;
}
async function quitApp(p = appProc) {
  if (!p || p.exitCode !== null) return;
  cmd("quit");
  if (!(await waitFor(() => p.exitCode !== null || p.signalCode !== null, 8000))) p.kill();
  await sleep(500);
  fs.writeFileSync(CMD, "");
}

// ── Fake browser and handler registration per OS ─────────────────────────────
let forwardSpec = "";
let fakeId = "";
function setupFake() {
  if (PLATFORM === "linux") {
    const script = path.join(FAKE_DIR, "fakebrowser.sh");
    fs.writeFileSync(script, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${FAKE_LOG}"; done\n`, { mode: 0o755 });
    const desktop = `[Desktop Entry]\nType=Application\nName=Fake Browser\nExec=${script} %u\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;\n`;
    fs.writeFileSync(path.join(env.XDG_DATA_HOME, "applications", "fakebrowser.desktop"), desktop);
    // The fake was the default browser before Linkwache (the assistant records it as target).
    run("xdg-mime", ["default", "fakebrowser.desktop", "x-scheme-handler/http", "x-scheme-handler/https"]);
    fakeId = "fakebrowser.desktop";
    forwardSpec = `linux-desktop:${fakeId}`;
  } else if (PLATFORM === "macos") {
    const dst = path.join(FAKE_DIR, "FakeBrowser.app");
    fs.cpSync(FAKE_IN, dst, { recursive: true });
    lsregister(dst);
    fakeId = "test.e2e.fakebrowser";
    forwardSpec = `mac-bundle:${fakeId}`;
  } else {
    const dst = path.join(FAKE_DIR, "fakebrowser.exe");
    fs.copyFileSync(FAKE_IN, dst);
    const key = "HKCU\\Software\\Clients\\StartMenuInternet\\FakeBrowser";
    run("reg", ["add", key, "/ve", "/d", "Fake Browser", "/f"]);
    run("reg", ["add", `${key}\\shell\\open\\command`, "/ve", "/d", `"${dst}"`, "/f"]);
    run("reg", ["add", `${key}\\Capabilities\\URLAssociations`, "/v", "https", "/d", "FakeBrowserURL", "/f"]);
    run("reg", ["add", "HKCU\\Software\\Classes\\FakeBrowserURL\\shell\\open\\command", "/ve", "/d", `"${dst}" "%1"`, "/f"]);
    fakeId = "FakeBrowser";
    forwardSpec = `win-client:${fakeId}`;
  }
}
function lsregister(p) {
  const ls = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  run(ls, ["-f", p]);
}

// How links are opened "through the OS" on this machine (decided after registration).
let openMethod = "";
function openViaOS(url) {
  // Non-web links always go through the plain OS route (Linkwache is not registered for them).
  if (!/^https?:/i.test(url)) {
    if (PLATFORM === "macos") return spawn("open", [url], { env, stdio: "ignore" });
    if (PLATFORM === "windows") return spawn("rundll32", ["url.dll,FileProtocolHandler", url], { env, stdio: "ignore" });
  }
  if (PLATFORM === "linux") return spawn("xdg-open", [url], { env, stdio: "ignore" });
  if (PLATFORM === "macos") return spawn("open", openMethod === "open" ? [url] : ["-a", BUNDLE, url], { env, stdio: "ignore" });
  if (openMethod === "shell") return spawn("rundll32", ["url.dll,FileProtocolHandler", url], { env, stdio: "ignore" });
  // Fallback: run the command Windows would run for the registered ProgID.
  const q = run("reg", ["query", "HKCU\\Software\\Classes\\LinkwacheURL\\shell\\open\\command", "/ve"]).out;
  const m = q.match(/REG_SZ\s+"([^"]+)"/);
  return spawn(m ? m[1] : APP, [url], { env, stdio: "ignore" });
}

async function makeDefault() {
  const md = cli(["--make-default"]);
  let st = cli(["--status"]).json || {};
  record("handler registered as browser candidate", md.code === 0 || PLATFORM !== "linux", JSON.stringify(md.json));
  if (PLATFORM === "linux") {
    openMethod = "xdg-open";
    record("Linkwache is the default (xdg-settings/xdg-mime)", !!st.isDefault, `isDefault=${st.isDefault}`);
    return;
  }
  if (PLATFORM === "macos") {
    await sleep(2000);
    screenshot("macos-default-browser-dialog");
    // The system asks "change your default web browser to Linkwache?". A user clicks
    // "Use Linkwache"; the test tries the same through System Events (needs accessibility rights).
    const click = run("osascript", ["-e", 'tell application "System Events" to tell process "CoreServicesUIAgent" to click (first button of window 1 whose name contains "Linkwache")']);
    notes.push(`macOS: clicking "Use Linkwache" in the system dialog via System Events: exit ${click.code} ${click.out.trim().slice(0, 160)}`);
    await sleep(2000);
    st = cli(["--status"]).json || {};
    if (st.isDefault) { openMethod = "open"; record("Linkwache is the default (LSSetDefaultHandlerForURLScheme)", true); return; }
    openMethod = "open-a";
    record("Linkwache is the default (LSSetDefaultHandlerForURLScheme)", false, "macOS wants the user to confirm the change in a dialog; links are delivered with `open -a Linkwache.app <url>` (same Apple Event path)", false);
    return;
  }
  // Windows: UserChoice is hash-protected; only the user may set it. For the test, remove
  // UserChoice (if Windows lets us) and set the legacy per-user protocol handler, so the
  // shell (url.dll) resolves http/https to Linkwache. If that fails, run the ProgID command.
  const del = ["http", "https"].map((s) => run("reg", ["delete", `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${s}\\UserChoice`, "/f"]).code);
  for (const s of ["http", "https"]) {
    run("reg", ["add", `HKCU\\Software\\Classes\\${s}`, "/v", "URL Protocol", "/d", "", "/f"]);
    run("reg", ["add", `HKCU\\Software\\Classes\\${s}\\shell\\open\\command`, "/ve", "/d", `"${APP}" "%1"`, "/f"]);
  }
  notes.push(`Windows: UserChoice delete exit codes http/https = ${del.join("/")}`);
  const probe = `https://example.com/e2e-probe-${Date.now()}`;
  const before = states().length;
  openMethod = "shell";
  openViaOS(probe);
  const seen = await waitState("incoming", (d) => d.url && d.url.startsWith(probe), 8000, before);
  if (!seen) {
    // Without a user choice Windows shows its app picker: Linkwache must be offered there.
    await sleep(2500);
    screenshot("windows-https-picker");
    const picker = run("tasklist", ["/FI", "IMAGENAME eq OpenWith.exe"]).out.includes("OpenWith.exe");
    notes.push(`Windows: app picker (OpenWith.exe) shown after removing UserChoice: ${picker} — see screenshot windows-https-picker`);
    run("taskkill", ["/IM", "OpenWith.exe", "/F"]);
  }
  if (seen) {
    record("OS shell (url.dll FileProtocolHandler) delivers links to Linkwache", true);
  } else {
    openMethod = "progid";
    record("OS shell (url.dll FileProtocolHandler) delivers links to Linkwache", false, "Windows kept its protected default; the test runs the registered LinkwacheURL ProgID command instead (what Windows runs once the user picked Linkwache)", false);
  }
  await waitFor(() => received().some((u) => u.startsWith(probe)), 4000);
  fs.writeFileSync(FAKE_LOG, "");
}

// ── Test cases ───────────────────────────────────────────────────────────────
async function caseGreen() {
  const url = `https://example.com/e2e-green-${Date.now()}`;
  const t0 = Date.now();
  openViaOS(url);
  const got = await waitFor(() => received().find((u) => u === url), 10000, 50);
  const ms = Date.now() - t0;
  const via = states().some((s) => s.event === "incoming" && s.data.url === url);
  record("green link went through Linkwache", via);
  record("green link reaches the real browser", !!got && via, `${ms} ms`);
  record("green link opens within 2 s", !!got && ms <= 2000, `${ms} ms`, PLATFORM === "linux");
  const toast = states().find((s) => s.event === "toast" && s.data.state === "green" && s.data.domain === "example.com");
  record("green toast shown", !!toast);
}

async function caseSlowToast() {
  const url = `https://example.net/e2e-slow-${Date.now()}`;
  const before = states().length;
  openViaOS(url);
  const checking = await waitState("toast", (d) => d.state === "checking" && d.domain === "example.net", 10000, before);
  record("checking toast shows the domain", !!checking);
  await sleep(500);
  screenshot("toast-checking");
  const green = await waitState("toast", (d) => d.state === "green", 10000, before);
  await sleep(150);
  if (green) screenshot("toast-green");
  const got = await waitFor(() => received().includes(url), 8000);
  record("slow green link reaches the real browser", !!got);
}

async function caseAmber() {
  const url = "https://cheap-deals.top/e2e-amber";
  const before = states().length;
  openViaOS(url);
  const w = await waitState("warning", (d) => d.stufe === "gelb", 12000, before);
  record("amber link shows the warning window", !!w, w ? `findings ${w.data.findings}` : "");
  if (!w) return;
  await sleep(2500);
  screenshot("warning-amber");
  cmd(`decide ${w.data.id} open`);
  const early = await waitState("decide", (d) => d.action === "open", 4000, before);
  record("amber: 'open anyway' refused before the delay", !!early && early.data.ok === false, early ? JSON.stringify(early.data) : "no answer");
  record("amber: nothing opened before the decision", !received().includes(url));
  await sleep(3200);
  const n = states().length;
  cmd(`decide ${w.data.id} open`);
  const late = await waitState("decide", (d) => d.action === "open", 4000, n);
  const got = await waitFor(() => received().includes(url), 6000);
  record("amber: 'open anyway' after the delay opens the link", !!late && late.data.ok && !!got);
}

async function caseRed() {
  const url = "https://paypal.com.secure-login.example/";
  const before = states().length;
  openViaOS(url);
  const w = await waitState("warning", (d) => d.stufe === "rot", 12000, before);
  record("red link shows the warning window", !!w, w ? `findings ${w.data.findings}` : "");
  if (!w) return;
  await sleep(3500);
  screenshot("warning-red");
  record("red link: the real browser received nothing", !received().includes(url), received().join(" "));
  const n1 = states().length;
  cmd(`decide ${w.data.id} open`);
  const plain = await waitState("decide", (d) => d.action === "open", 4000, n1);
  record("red: plain 'open' is refused", !!plain && plain.data.ok === false);
  const n2 = states().length;
  cmd(`decide ${w.data.id} open-red`);
  const noStep = await waitState("decide", (d) => d.action === "open-red", 4000, n2);
  record("red: confirm without the second step is refused", !!noStep && noStep.data.ok === false);
  record("red: still nothing opened", !received().includes(url));
  cmd(`decide ${w.data.id} red-step`);
  await sleep(1800);
  const n3 = states().length;
  cmd(`decide ${w.data.id} open-red`);
  const ok = await waitState("decide", (d) => d.action === "open-red", 4000, n3);
  const got = await waitFor(() => received().includes(url), 6000);
  record("red: deliberate second step opens and is logged", !!ok && ok.data.ok && !!got);
}

async function caseOffline() {
  await stopMock();
  const url = `https://example.org/e2e-offline-${Date.now()}`;
  const before = states().length;
  openViaOS(url);
  const w = await waitState("warning", (d) => d.stufe === "offline", 20000, before);
  record("server down: 'could not be checked' window", !!w, w ? `reason ${w.data.reason}` : "");
  await sleep(2500);
  screenshot("warning-offline");
  record("server down: nothing opened", !received().includes(url));
  if (w) cmd(`decide ${w.data.id} close`);
  await sleep(800);
}

async function caseMailto() {
  const before = states().length;
  const p = openViaOS("mailto:e2e@example.com");
  p.on("error", () => {});
  await sleep(3000);
  if (PLATFORM === "windows") run("taskkill", ["/IM", "OpenWith.exe", "/F"]);
  const handled = states().slice(before).some((s) => s.event === "incoming" && String(s.data.url).startsWith("mailto:"));
  record("mailto: is not handled by Linkwache (not registered)", !handled);
  // If a mailto link ever reaches the app, it is refused and never launched.
  const b2 = states().length;
  spawn(APP, ["mailto:e2e@example.com"], { env, stdio: "ignore" });
  const refused = await waitState("refused", (d) => d.scheme === "mailto", 10000, b2);
  await sleep(400);
  screenshot("toast-refused");
  record("mailto: reaching the app is refused", !!refused);
  record("mailto: nothing launched", !received().some((u) => u.startsWith("mailto:")));
}

function casePrivacy() {
  const reqs = fs.readFileSync(REQ_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const leaked = reqs.filter((r) => /[?#]/.test(r.body.url) || /@/.test(r.body.url));
  record("server received no query strings, fragments or user info", reqs.length > 0 && leaked.length === 0, `${reqs.length} requests`);
  record("client header desktop/<version>", reqs.every((r) => /^desktop\/\d+\.\d+\.\d+/.test(r.client || "")));
}

async function caseShipped() {
  if (!SHIPPED) return;
  await quitApp();
  await startMock();
  fs.writeFileSync(FAKE_LOG, "");
  const reg = run(SHIPPED, ["--register"]);
  if (PLATFORM === "windows" && openMethod === "shell") {
    for (const s of ["http", "https"]) run("reg", ["add", `HKCU\\Software\\Classes\\${s}\\shell\\open\\command`, "/ve", "/d", `"${SHIPPED}" "%1"`, "/f"]);
  }
  record("release build: --register", reg.code === 0, reg.out.trim().slice(0, 200));
  const sst = run(SHIPPED, ["--status"]);
  let shippedDefault = false;
  try { shippedDefault = JSON.parse(sst.stdout).isDefault === true; } catch { /* windows: no console */ }
  if (PLATFORM === "linux") record("release build: Linkwache is the default handler", shippedDefault);
  const p = spawn(SHIPPED, ["--autostart"], { env, stdio: "ignore" });
  children.push(p);
  await sleep(3000);
  const url = `https://example.com/e2e-release-${Date.now()}`;
  openViaOS(url);
  const got = await waitFor(() => received().includes(url), 10000);
  record("release build: green link reaches the real browser", !!got);
  openViaOS("https://paypal-konto.example/e2e-release-red");
  await sleep(5000);
  screenshot("release-warning-red");
  record("release build: red link does not reach the browser", !received().some((u) => u.includes("e2e-release-red")));
  p.kill();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log("platform", PLATFORM, "app", APP);
  if (PLATFORM === "linux") await linuxEnv();
  if (PLATFORM === "macos" && BUNDLE) lsregister(BUNDLE);
  if (PLATFORM === "macos") {
    // Browser profile folders, so the native-messaging manifests have somewhere to go.
    for (const d of ["Google/Chrome", "Mozilla"]) fs.mkdirSync(path.join(os.homedir(), "Library/Application Support", d), { recursive: true });
  }
  setupFake();
  await startMock();

  // First start: the setup assistant appears.
  const first = startApp(APP);
  const setup = await waitState("window", (d) => d.window === "setup", 30000);
  record("first start opens the setup assistant", !!setup);
  await sleep(2500);
  screenshot("setup-assistant");
  await quitApp(first);

  const conf = cli(["--configure", `server=${SERVER}`, `forward=${forwardSpec}`, "setup-done=1", "lang=en", "update-check=0", "autostart=0"]);
  record("configure server + forward target", conf.code === 0, conf.out.trim().slice(0, 200));
  const reg = cli(["--register"]);
  record("register handler + native-messaging hosts", reg.code === 0, JSON.stringify(reg.json));
  await makeDefault();
  const status = cli(["--status"]).json || {};
  // Artifacts are public: never keep a server address other than the local mock.
  const redact = (o) => JSON.stringify(o, (k, v) => (k === "server" && v && v !== SERVER ? "(build default, redacted)" : v), 2);
  fs.writeFileSync(path.join(OUT, "status.json"), redact(status));
  fs.writeFileSync(path.join(OUT, "cli-status.json"), redact(status));
  record("native-messaging host manifests installed", Array.isArray(status.nativeHosts) && status.nativeHosts.length > 0, JSON.stringify(status.nativeHosts), PLATFORM !== "macos");
  record("forward target is the fake browser, never Linkwache", status.forward && status.forward.id === fakeId);

  const before = states().length;
  startApp(APP, ["--autostart"]);
  const started = await waitState("started", () => true, 30000, before);
  record("app starts in the background", !!started);
  const tray = await waitState("tray", () => true, 5000, before);
  record("tray icon created", !!tray, tray ? tray.data.status : "", PLATFORM !== "linux");
  await sleep(1500);
  screenshot("tray");

  await caseGreen();
  await caseSlowToast();
  await caseAmber();
  await caseRed();
  cmd("settings history");
  await sleep(2500);
  screenshot("settings-history");
  casePrivacy();
  await caseMailto();
  await caseOffline();
  await caseShipped();
  await quitApp();
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; record("test run", false, String(e.stack || e)); }
for (const c of children) { try { if (c.exitCode === null) c.kill(); } catch { /* gone */ } }
const failed = results.filter((r) => r.required && !r.ok);
const summary = { platform: PLATFORM, openMethod, passed: results.filter((r) => r.ok).length, failed: failed.length, results, notes };
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log("\n=== Linkwache desktop E2E (" + PLATFORM + ", open via " + openMethod + ") ===");
for (const r of results) console.log(`${r.ok ? "PASS" : r.required ? "FAIL" : "WARN"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
for (const n of notes) console.log("NOTE  " + n);
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [`### Desktop E2E – ${PLATFORM} (open via ${openMethod})`, "", "| | case | detail |", "|---|---|---|",
    ...results.map((r) => `| ${r.ok ? "✅" : r.required ? "❌" : "⚠️"} | ${r.name} | ${String(r.detail).replace(/\|/g, "/").slice(0, 160)} |`),
    "", ...notes.map((n) => `- ${n}`), ""].join("\n");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
process.exit(failed.length || crashed ? 1 : 0);
