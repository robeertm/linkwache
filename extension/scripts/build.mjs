// Builds the extension from one source into extension/dist/chromium/, extension/dist/firefox/, extension/dist/safari/
// (unpacked, loadable) and extension/dist/linkwache-extension-<chromium|firefox>-<version>.zip. The Safari folder is what the Xcode
// project in safari/ copies into its app extension; dist/safari-app-strings.json carries the container app's texts.
//   node extension/scripts/build.mjs [chromium] [firefox] [safari]    (no argument: all three) No runtime bundler: every script is one self-contained file.
//   LINKWACHE_DEFAULT_SERVER=https://... npm run build:extension    (default server address; empty otherwise)
//   LINKWACHE_FALLBACK_SERVER=https://...                            (reserve server, docs/FALLBACK.md; empty otherwise)
//   LINKWACHE_PRESET_MIGRATE_FROM="https://... https://..."           (earlier default addresses installations move away from)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { STRINGS, LANGS } from "../../src/i18n.js";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.LINKWACHE_EXT_DIST ? path.resolve(process.env.LINKWACHE_EXT_DIST) : path.join(EXT, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(EXT, "..", "package.json"), "utf8"));
const VERSION = pkg.version;
const DEFAULT_SERVER = process.env.LINKWACHE_DEFAULT_SERVER || "";
const FALLBACK_SERVER = process.env.LINKWACHE_FALLBACK_SERVER || "";
const PRESET_MIGRATE_FROM = process.env.LINKWACHE_PRESET_MIGRATE_FROM || "";
const KEY_PREFIXES = ["ext.", "f.", "pat.", "v.", "stufe.", "age."];
export const TARGETS = ["chromium", "firefox", "safari"];

/** Strings the extension needs, per language, from the website's single source of truth. */
export function extensionStrings() {
  const out = {};
  for (const l of LANGS) {
    out[l] = {};
    for (const [k, v] of Object.entries(STRINGS[l])) if (KEY_PREFIXES.some((p) => k.startsWith(p))) out[l][k] = v;
  }
  return out;
}

/** Texts of the Safari container app (safari.app.*), per language. */
export function safariAppStrings() {
  const out = {};
  for (const l of LANGS) {
    out[l] = {};
    for (const [k, v] of Object.entries(STRINGS[l])) if (k.startsWith("safari.app.")) out[l][k.slice("safari.app.".length)] = v;
  }
  return out;
}

const stringsPlugin = {
  name: "lw-strings",
  setup(b) {
    b.onResolve({ filter: /^lw-strings$/ }, () => ({ path: "lw-strings", namespace: "lw" }));
    b.onLoad({ filter: /.*/, namespace: "lw" }, () => ({ contents: `export const LANGS = ${JSON.stringify(LANGS)};\nexport const STRINGS = ${JSON.stringify(extensionStrings())};`, loader: "js" }));
  },
};

const ENTRIES = ["background", "content", "warning", "options"];
const STATIC = ["warning.html", "options.html", "ui.css"];

function crc32(buf) { return zlib.crc32 ? zlib.crc32(buf) : (() => { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; })(); }

/** Minimal deterministic zip writer (deflate, fixed timestamp), so the build needs no zip tool. */
export function zipDir(dir, file) {
  const files = [];
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(dir);
  const parts = [], central = [];
  let offset = 0;
  const date = 0x5a21 /* 2025-01-01 */, time = 0;
  for (const p of files) {
    const name = Buffer.from(path.relative(dir, p).split(path.sep).join("/"));
    const data = fs.readFileSync(p), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
}

const merge = (a, b) => ({ ...a, ...b });

async function buildTarget(target) {
  const out = path.join(DIST, target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await build({
    entryPoints: ENTRIES.map((e) => path.join(EXT, "src", e + ".js")), outdir: out, bundle: true, format: "iife", target: "es2022",
    platform: "browser", plugins: [stringsPlugin], legalComments: "none", logLevel: "warning",
    define: { LW_TARGET: JSON.stringify(target), LW_DEFAULT_SERVER: JSON.stringify(DEFAULT_SERVER), LW_FALLBACK_SERVER: JSON.stringify(FALLBACK_SERVER), LW_PRESET_MIGRATE_FROM: JSON.stringify(PRESET_MIGRATE_FROM) },
  });
  for (const f of STATIC) fs.copyFileSync(path.join(EXT, f), path.join(out, f));
  fs.cpSync(path.join(EXT, "icons"), path.join(out, "icons"), { recursive: true });
  // The extension bundles only the project's own code (no third-party notices needed), but carries its licence.
  fs.copyFileSync(path.join(EXT, "..", "LICENSE"), path.join(out, "LICENSE"));
  const base = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.base.json"), "utf8"));
  const extra = JSON.parse(fs.readFileSync(path.join(EXT, `manifest.${target}.json`), "utf8"));
  const manifest = merge(merge(base, extra), { version: VERSION });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const S = extensionStrings();
  for (const l of LANGS) {
    const dir = path.join(out, "_locales", l);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "messages.json"), JSON.stringify({
      extName: { message: S[l]["ext.name"].slice(0, 75) },
      extDesc: { message: S[l]["ext.desc"].slice(0, 132) },
    }, null, 2) + "\n");
  }
  // Safari has no zip: Safari loads the extension only from the container app (safari/), which copies this folder.
  // A zip in the release would be of no use to anyone.
  if (target === "safari") return { out, zip: null };
  const zip = path.join(DIST, `linkwache-extension-${target}-${VERSION}.zip`);
  fs.rmSync(zip, { force: true });
  zipDir(out, zip);
  return { out, zip };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(DIST, { recursive: true });
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  for (const a of wanted) if (!TARGETS.includes(a)) { console.error(`unknown target ${a} (${TARGETS.join(", ")})`); process.exit(2); }
  for (const target of wanted.length ? wanted : TARGETS) {
    const { out, zip } = await buildTarget(target);
    console.log(zip ? `${target}: ${path.relative(process.cwd(), out)}  ${path.relative(process.cwd(), zip)} (${fs.statSync(zip).size} bytes)` : `${target}: ${path.relative(process.cwd(), out)}  (no zip: loaded through the container app)`);
    if (target === "safari") {
      const f = path.join(DIST, "safari-app-strings.json");
      fs.writeFileSync(f, JSON.stringify({ version: VERSION, langs: LANGS, strings: safariAppStrings() }, null, 2) + "\n");
      console.log(`safari app strings: ${path.relative(process.cwd(), f)}`);
    }
  }
}
