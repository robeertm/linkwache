#!/usr/bin/env node
// Compose the release assets from the CI build artifacts: keep Tauri's asset names (the
// download page classifies them by pattern), give the macOS updater tarball a versioned name,
// write the updater manifest latest.json and SHA256SUMS.txt over every asset.
// Usage: node desktop/scripts/release-assets.mjs --in dist/raw --out dist/release --tag v0.5.0 --repo owner/name
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const arg = (n) => { const i = process.argv.indexOf(n); if (i < 0) throw new Error(`missing ${n}`); return process.argv[i + 1]; };
const IN = arg("--in"), OUT = arg("--out"), TAG = arg("--tag"), REPO = arg("--repo");
const VERSION = TAG.replace(/^v/, "");
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(IN).filter((f) => fs.statSync(path.join(IN, f)).isFile());
const pick = (re) => files.filter((f) => re.test(f));
const copied = [];
function put(src, name = src) {
  fs.copyFileSync(path.join(IN, src), path.join(OUT, name));
  copied.push(name);
  return name;
}

const PATTERNS = [
  /_x64-setup\.exe(\.sig)?$/, /_x64_[a-z]{2}-[A-Z]{2}\.msi(\.sig)?$/, /_universal\.dmg$/, /_(x64|aarch64)\.dmg$/,
  /_amd64\.AppImage(\.sig)?$/, /_aarch64\.AppImage(\.sig)?$/, /_amd64\.deb(\.sig)?$/, /_arm64\.deb(\.sig)?$/,
  /-1\.x86_64\.rpm(\.sig)?$/, /-1\.aarch64\.rpm(\.sig)?$/, /\.zip$/,
];
for (const f of files) if (PATTERNS.some((re) => re.test(f)) && (f.includes(VERSION) || f.endsWith(".zip"))) put(f);
// macOS updater tarball: Tauri names it "Linkwache.app.tar.gz" — make it unique per version.
for (const f of pick(/\.app\.tar\.gz(\.sig)?$/)) put(f, f.replace(/^Linkwache\.app\.tar\.gz/, `Linkwache_${VERSION}_universal.app.tar.gz`));

const url = (name) => `https://github.com/${REPO}/releases/download/${TAG}/${name}`;
const sig = (name) => (fs.existsSync(path.join(OUT, name + ".sig")) ? fs.readFileSync(path.join(OUT, name + ".sig"), "utf8").trim() : null);
const entry = (name) => (name && sig(name) ? { signature: sig(name), url: url(name) } : null);
const first = (re) => copied.find((f) => re.test(f) && !f.endsWith(".sig"));

const nsis = first(/_x64-setup\.exe$/), msi = first(/\.msi$/), mac = first(/_universal\.app\.tar\.gz$/);
const appX = first(/_amd64\.AppImage$/), appA = first(/_aarch64\.AppImage$/);
const debX = first(/_amd64\.deb$/), debA = first(/_arm64\.deb$/), rpmX = first(/x86_64\.rpm$/), rpmA = first(/aarch64\.rpm$/);
const platforms = {};
const add = (key, name) => { const e = entry(name); if (e) platforms[key] = e; };
add("windows-x86_64", nsis); add("windows-x86_64-nsis", nsis); add("windows-x86_64-msi", msi);
add("darwin-aarch64", mac); add("darwin-x86_64", mac); add("darwin-aarch64-app", mac); add("darwin-x86_64-app", mac);
add("linux-x86_64", appX); add("linux-x86_64-appimage", appX); add("linux-aarch64", appA); add("linux-aarch64-appimage", appA);
add("linux-x86_64-deb", debX); add("linux-aarch64-deb", debA); add("linux-x86_64-rpm", rpmX); add("linux-aarch64-rpm", rpmA);

const missing = ["windows-x86_64", "darwin-aarch64", "linux-x86_64", "linux-aarch64"].filter((k) => !platforms[k]);
const manifest = { version: VERSION, notes: `Linkwache ${VERSION}`, pub_date: new Date().toISOString(), platforms };
fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
copied.push("latest.json");

const sums = copied.sort().map((f) => `${crypto.createHash("sha256").update(fs.readFileSync(path.join(OUT, f))).digest("hex")}  ${f}`);
fs.writeFileSync(path.join(OUT, "SHA256SUMS.txt"), sums.join("\n") + "\n");

console.log(`assets (${copied.length + 1}):\n  ` + [...copied, "SHA256SUMS.txt"].join("\n  "));
console.log("updater platforms:", Object.keys(platforms).join(", "));
if (missing.length) {
  console.error("missing updater platforms:", missing.join(", "));
  if (!process.env.ALLOW_PARTIAL) process.exit(1);
}
