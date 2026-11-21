// Download page: release parsing, asset classification, system detection, rendering in 8 languages, CSP-friendly markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.js";
import { parseRelease, parseSums, fetchRelease, startUpdateCheck } from "../server/update.js";
import { classify, detectOS, recommend, SAFARI_GUIDE } from "../src/downloads.js";
import { LANGS } from "../src/i18n.js";
import { PAGES } from "../src/i18n_pages.js";

const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/release.json", import.meta.url), "utf8"));
const SUMS = fs.readFileSync(new URL("./fixtures/SHA256SUMS.txt", import.meta.url), "utf8");

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  linuxArm: "Mozilla/5.0 (X11; Linux aarch64; rv:130.0) Gecko/20100101 Firefox/130.0",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
};

test("parseRelease: tag, date, assets with digest", () => {
  const r = parseRelease(FIX);
  assert.equal(r.tag, "v0.5.0");
  assert.equal(r.version, "0.5.0");
  assert.equal(r.date, "2026-11-16");
  const exe = r.assets.find((a) => a.name.endsWith("-setup.exe"));
  assert.equal(exe.sha256, "a1".repeat(32));
  assert.equal(exe.size, 5242880);
  assert.match(exe.url, /^https:\/\/github\.com\//);
  assert.equal(r.assets.find((a) => a.name.endsWith(".rpm") && a.name.includes("aarch64")).sha256, "", "no digest = empty");
  assert.equal(parseRelease({ tag_name: "nightly" }), null);
  assert.equal(parseRelease(null), null);
  const bad = parseRelease({ tag_name: "v1.0.0", assets: [{ name: "x.exe", size: 1, browser_download_url: "http://insecure.example/x.exe" }] });
  assert.equal(bad.assets.length, 0, "only https download links are kept");
});

test("parseSums reads sha256sum lines, with or without the binary marker", () => {
  const m = parseSums(SUMS);
  assert.equal(m["linkwache-extension-firefox-0.5.0.zip"], "c1".repeat(32));
  assert.equal(m["Linkwache-0.5.0-1.aarch64.rpm"], "c2".repeat(32));
  assert.equal(Object.keys(m).length, 2);
});

test("fetchRelease fills missing digests from SHA256SUMS.txt", async () => {
  const fetchFn = async (url) => url.endsWith("SHA256SUMS.txt")
    ? { ok: true, text: async () => SUMS }
    : { ok: true, json: async () => FIX };
  const r = await fetchRelease("x/y", fetchFn);
  assert.equal(r.assets.find((a) => a.name.includes("firefox")).sha256, "c1".repeat(32));
  assert.equal(r.assets.find((a) => a.name.includes("chromium")).sha256, "a9".repeat(32), "GitHub's own digest wins");
});

test("update check keeps the release for the download page", async () => {
  const info = {};
  const timer = startUpdateCheck(info, { current: "0.4.0", repo: "x/y", log() {}, every: 3600000, fetchFn: async () => ({ ok: true, json: async () => FIX, text: async () => "" }) });
  await new Promise((r) => setTimeout(r, 20));
  clearInterval(timer);
  assert.equal(info.release.version, "0.5.0");
  assert.equal(info.latest, "0.5.0");
});

test("classify: every package, ignoring signatures, updater archives and manifests", () => {
  const c = classify(parseRelease(FIX).assets);
  assert.deepEqual(c.map((p) => p.id), ["win-exe", "win-msi", "mac-dmg", "linux-appimage-x64", "linux-appimage-arm64", "linux-deb-x64", "linux-deb-arm64", "linux-rpm-x64", "linux-rpm-arm64", "ext-chromium", "ext-firefox"]);
  assert.equal(c.find((p) => p.id === "mac-dmg").arch, "universal");
  assert.ok(!c.some((p) => /\.(sig|json|txt|tar\.gz)$/.test(p.name)));
  assert.ok(!c.some((p) => p.group === "android"), "no APK in this release");
  const withApk = classify([...parseRelease(FIX).assets, { name: "Linkwache-0.5.0.apk", size: 9e6, url: "https://x.example/a.apk", sha256: "" }]);
  assert.equal(withApk.at(-1).id, "android-apk");
  const dmgs = classify([{ name: "L_0.5.0_x64.dmg", url: "u" }, { name: "L_0.5.0_aarch64.dmg", url: "u" }]);
  assert.deepEqual(dmgs.map((p) => p.arch), ["x64", "arm64"]);
});

test("detectOS and recommend", () => {
  assert.equal(detectOS(UA.win), "windows");
  assert.equal(detectOS(UA.mac), "macos");
  assert.equal(detectOS(UA.linux), "linux");
  assert.equal(detectOS(UA.android), "android");
  assert.equal(detectOS(UA.iphone), "ios");
  assert.equal(detectOS(""), "other");
  const c = classify(parseRelease(FIX).assets);
  assert.equal(recommend("windows", c).id, "win-exe");
  assert.equal(recommend("macos", c).id, "mac-dmg");
  assert.equal(recommend("linux", c, UA.linux).id, "linux-appimage-x64");
  assert.equal(recommend("linux", c, UA.linuxArm).id, "linux-appimage-arm64");
  assert.equal(recommend("android", c), null, "no APK: nothing to recommend");
  assert.equal(recommend("ios", c), null);
});

const envWith = (release) => ({ SITE_NAME: "Linkwache", SITE_URL: "https://example.test", ASSET_VER: "t", UPDATE_INFO: release ? { release: parseRelease(release) } : {}, ASSETS: { async fetch() { return new Response("", { status: 404 }); } } });
const get = (env, path, ua = "") => worker.fetch(new Request("https://example.test" + path, { headers: ua ? { "user-agent": ua } : {} }), env, { waitUntil() {} });

test("page renders in all 8 languages, with and without release data, always 200", async () => {
  for (const l of LANGS) {
    const full = await get(envWith(FIX), "/download?lang=" + l, UA.win);
    assert.equal(full.status, 200, l);
    const h = await full.text();
    assert.ok(h.includes("Linkwache_0.5.0_x64-setup.exe") && h.includes("a1".repeat(32)), l);
    assert.ok(h.includes(PAGES[l]["dl.h1"]), l);
    assert.ok(h.includes(PAGES[l]["dl.win.mock.title"]), l + " localized SmartScreen illustration");
    assert.ok(h.includes("Get-FileHash"), l);
    assert.ok(!/\{[a-z]+\}/.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), l + " no unresolved placeholder");
    const none = await get(envWith(null), "/download?lang=" + l, UA.win);
    assert.equal(none.status, 200, l + " without data");
    const nh = await none.text();
    assert.ok(nh.includes(PAGES[l]["dl.none.h"]) && nh.includes("github.com/robeertm/linkwache/releases"), l);
    assert.ok(!nh.includes("Get-FileHash"));
  }
});

test("every dl.*, home.app.p and privacy.app/dl key exists in all languages", () => {
  const keys = Object.keys(PAGES.de).filter((k) => /^(dl\.|home\.app|privacy\.(app|dl))/.test(k));
  assert.ok(keys.length > 60);
  for (const l of LANGS) for (const k of keys) assert.ok(PAGES[l][k] && PAGES[l][k].length > 1, l + " " + k);
});

test("wording rule: never 'safe' for a link in the new texts", () => {
  const bad = /\b(safe|sicher|güvenli|bezpieczn|безопасн|seguro|sûr|sicuro)\b/i;
  for (const l of LANGS) for (const [k, v] of Object.entries(PAGES[l])) if (/^(dl\.|home\.app|privacy\.(app|dl))/.test(k)) assert.ok(!bad.test(v), l + " " + k);
});

test("UA decides the highlighted package; all packages stay listed", async () => {
  const env = envWith(FIX);
  const first = async (ua, os = "") => { const h = await (await get(env, "/download?lang=en" + (os ? "&os=" + os : ""), ua)).text(); return { h, prim: (/class="pkg primary">[\s\S]*?<\/div>\s*<\/div>/.exec(h) || [""])[0] }; };
  assert.match((await first(UA.win)).prim, /Download for Windows[\s\S]*x64-setup\.exe/);
  assert.match((await first(UA.mac)).prim, /Download for macOS[\s\S]*universal\.dmg/);
  assert.match((await first(UA.linux)).prim, /Download for Linux[\s\S]*amd64\.AppImage/);
  assert.match((await first(UA.linuxArm)).prim, /aarch64\.AppImage/);
  const android = await first(UA.android);
  assert.equal(android.prim, "");
  assert.match(android.h, /Android: being prepared/);
  const ios = await first(UA.iphone);
  assert.match(ios.h, /kurzbefehl\.html\?lang=en/);
  assert.equal((await first(UA.win, "linux")).prim.includes("AppImage"), true, "?os= overrides the guess");
  for (const f of ["x64-setup.exe", ".msi", "universal.dmg", "amd64.AppImage", "aarch64.AppImage", "amd64.deb", "arm64.deb", "x86_64.rpm", "aarch64.rpm", "chromium-0.5.0.zip", "firefox-0.5.0.zip"]) assert.ok(android.h.includes(f), f);
  assert.ok(!android.h.includes("SHA256SUMS") && !android.h.includes(".sig"));
});

test("an APK in the release turns the Android line into a download", async () => {
  const withApk = { ...FIX, assets: [...FIX.assets, { name: "Linkwache-0.5.0.apk", size: 9437184, browser_download_url: "https://github.com/robeertm/linkwache/releases/download/v0.5.0/Linkwache-0.5.0.apk", digest: "sha256:" + "d1".repeat(32) }] };
  const h = await (await get(envWith(withApk), "/download?lang=en", UA.android)).text();
  assert.match(h, /class="pkg primary"[\s\S]*Linkwache-0\.5\.0\.apk/);
  assert.ok(!h.includes("Android: being prepared"));
});

test("no inline script, no inline handler, no external resources on the page (CSP: script-src 'self')", async () => {
  for (const l of LANGS) {
    const h = await (await get(envWith(FIX), "/download?lang=" + l, UA.win)).text();
    const inline = [...h.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1]) && !/type="application\/json"/.test(m[1]));
    assert.equal(inline.length, 0, l);
    assert.ok(!/\son[a-z]+\s*=/i.test(h), l + " inline handler");
    assert.ok(!/<(img|script|link)[^>]+(src|href)="https?:\/\/(?!github\.com)/.test(h.replace(/rel="(alternate|canonical)"[^>]*>/g, "")), l);
  }
});

test("home page carries the quiet hint to /download, the nav links it, the privacy page covers app, extension and downloads", async () => {
  for (const l of LANGS) {
    const home = await (await get(envWith(FIX), "/?lang=" + l)).text();
    assert.ok(home.includes(`href="/download?lang=${l}"`), l);
    const priv = await (await get(envWith(FIX), "/datenschutz.html?lang=" + l)).text();
    assert.ok(priv.includes(PAGES[l]["privacy.app.h"]) && priv.includes(PAGES[l]["privacy.dl.h"]), l);
    assert.match(priv, /2026/);
  }
  const de = await (await get(envWith(FIX), "/datenschutz.html?lang=de")).text();
  assert.match(de, /18\. November 2026/);
});

test("download page shows the release date per language, never as ISO", async () => {
  const { formatDate } = await import("../src/render.js");
  assert.equal(formatDate("de", "2026-11-16"), "16. Nov. 2026");
  assert.equal(formatDate("en", "2026-11-16"), "Nov 16, 2026");
  assert.equal(formatDate("de", "garbage"), "garbage");
  assert.equal(formatDate("de", ""), "");
  const seen = new Set();
  for (const l of LANGS) {
    const f = formatDate(l, "2026-11-16");
    assert.ok(/2026/.test(f) && /16/.test(f) && !f.includes("2026-11-16"), `${l}: ${f}`);
    seen.add(f);
    const h = await (await get(envWith(FIX), "/download?lang=" + l, UA.win)).text();
    assert.ok(!h.includes("2026-11-16"), `${l}: ISO date still on the page`);
    assert.ok(h.includes(f), `${l}: formatted date missing`);
  }
  assert.ok(seen.size >= 6, "dates should differ between languages");
});

test("Safari build-it-yourself block renders in all 8 languages with the guide link; all dl.ext.s* keys exist", async () => {
  assert.equal(SAFARI_GUIDE, "https://github.com/robeertm/linkwache/blob/main/docs/DESKTOP.md#safari");
  const keys = Object.keys(PAGES.de).filter((k) => /^dl\.ext\.(s\d?|s\.\w+|safari\.h)$/.test(k));
  assert.equal(keys.length, 7);
  for (const l of LANGS) {
    for (const k of keys) assert.ok(PAGES[l][k] && PAGES[l][k].length > 1, l + " " + k);
    const h = await (await get(envWith(FIX), "/download?lang=" + l, UA.win)).text();
    for (const k of ["dl.ext.safari.h", "dl.ext.s.lead", "dl.ext.s1", "dl.ext.s2", "dl.ext.s3", "dl.ext.s.note"]) assert.ok(h.includes(PAGES[l][k]), l + " " + k);
    assert.ok(h.includes('href="' + SAFARI_GUIDE + '"') && h.includes(PAGES[l]["dl.ext.s.src"] + "</a>"), l + " guide link");
  }
});

test("Android: install help with a QR code to this page (not on an Android phone), steps in all languages", async () => {
  const withApk = { ...FIX, assets: [...FIX.assets, { name: "Linkwache-android-0.5.0.apk", size: 1658458, browser_download_url: "https://github.com/robeertm/linkwache/releases/download/v0.5.0/Linkwache-android-0.5.0.apk", digest: "sha256:" + "d1".repeat(32) }] };
  const env = { ...envWith(withApk), SITE_URL: "https://lw.example.test" };
  for (const l of LANGS) {
    const win = await (await get(env, "/download?lang=" + l, UA.win)).text();
    assert.match(win, /<details class="karte helpbox" id="android">/, l);
    assert.match(win, /<svg class="qr"[^>]*viewBox="0 0 (\d+) \1"/, l + " QR on the computer page");
    assert.ok(win.includes(PAGES[l]["dl.and.s1"]), l);
    assert.ok(!/style="/.test(win.match(/<svg class="qr"[\s\S]*?<\/svg>/)[0]), l + " no inline style in the QR (CSP)");
    const and = await (await get(env, "/download?lang=" + l, UA.android)).text();
    assert.match(and, /id="android" open/, l);
    assert.ok(!and.includes('class="qr"'), l + " no QR on the phone itself");
  }
  const none = await (await get({ ...envWith(FIX), SITE_URL: "http://plain.example.test" }, "/download?lang=en", UA.win)).text();
  assert.ok(!none.includes("<svg class=\"qr\""), "no QR without a public https address");
});

test("update check looks again soon while the release has no APK yet, and stops once it is attached", async () => {
  const noApk = FIX;
  const withApk = { ...FIX, assets: [...FIX.assets, { name: "Linkwache-android-0.5.0.apk", size: 1, browser_download_url: "https://github.com/x/y/a.apk", digest: "sha256:" + "d1".repeat(32) }] };
  let calls = 0;
  const fetchFn = async () => ({ ok: true, json: async () => (++calls >= 3 ? withApk : noApk), text: async () => "" });
  const info = {};
  const timer = startUpdateCheck(info, { current: "0.4.0", repo: "x/y", log() {}, every: 3600000, quick: 25, fetchFn });
  await new Promise((r) => setTimeout(r, 400));
  clearInterval(timer);
  assert.equal(calls, 3, "two quick re-reads, then no more");
  assert.ok(info.release.assets.some((a) => /\.apk$/.test(a.name)));
});

test("update check retries soon when the very first read fails (network not up right after a start)", async () => {
  let calls = 0;
  const fetchFn = async () => { if (++calls === 1) throw new Error("ENOTFOUND"); return { ok: true, json: async () => ({ ...FIX, assets: [...FIX.assets, { name: "Linkwache-android-0.5.0.apk", size: 1, browser_download_url: "https://github.com/x/y/a.apk", digest: "sha256:" + "d1".repeat(32) }] }), text: async () => "" }; };
  const info = {};
  const timer = startUpdateCheck(info, { current: "0.4.0", repo: "x/y", log() {}, every: 3600000, quick: 25, fetchFn });
  await new Promise((r) => setTimeout(r, 300));
  clearInterval(timer);
  assert.equal(calls, 2, "one failure, one retry, then done (APK present)");
  assert.ok(info.release && info.release.assets.length);
});
