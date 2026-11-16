// Download page logic without any HTML: sort release assets into the packages the page offers
// and guess the visitor's system from the User-Agent. Names follow the Tauri defaults; nothing is hard-coded
// per version. Signatures, updater archives, manifests and checksum files are ignored.

export const REPO_RELEASES = "https://github.com/robeertm/linkwache/releases";
export const SAFARI_GUIDE = "https://github.com/robeertm/linkwache/blob/main/docs/DESKTOP.md#safari";

const ARCH = (n) => (/(aarch64|arm64)/i.test(n) ? "arm64" : /universal/i.test(n) ? "universal" : "x64");

/** Rules in order; the first match wins. id is unique per package; group is the system. */
const RULES = [
  { id: "win-exe", group: "windows", test: /_(x64|amd64)-setup\.exe$/i },
  { id: "win-exe-arm64", group: "windows", test: /_(arm64|aarch64)-setup\.exe$/i },
  { id: "win-msi", group: "windows", test: /\.msi$/i },
  { id: "mac-dmg", group: "macos", test: /\.dmg$/i },
  { id: "linux-appimage-x64", group: "linux", test: /(_|-)(amd64|x86_64)\.AppImage$/i },
  { id: "linux-appimage-arm64", group: "linux", test: /(_|-)(aarch64|arm64)\.AppImage$/i },
  { id: "linux-deb-x64", group: "linux", test: /(_|-)(amd64|x86_64)\.deb$/i },
  { id: "linux-deb-arm64", group: "linux", test: /(_|-)(arm64|aarch64)\.deb$/i },
  { id: "linux-rpm-x64", group: "linux", test: /\.x86_64\.rpm$/i },
  { id: "linux-rpm-arm64", group: "linux", test: /\.aarch64\.rpm$/i },
  { id: "ext-chromium", group: "extension", test: /^linkwache-extension-chromium-.+\.zip$/i },
  { id: "ext-firefox", group: "extension", test: /^linkwache-extension-firefox-.+\.(zip|xpi)$/i },
  { id: "android-apk", group: "android", test: /\.apk$/i },
];
export const GROUPS = ["windows", "macos", "linux", "extension", "android"];

/** assets: [{name,size,url,sha256}] -> packages in page order. Several assets for one id (e.g. two dmg): all kept, arch noted. */
export function classify(assets = []) {
  const out = [];
  for (const a of assets) {
    if (!a || typeof a.name !== "string") continue;
    if (/\.(sig|tar\.gz|json|txt)$/i.test(a.name)) continue;
    const rule = RULES.find((r) => r.test.test(a.name));
    if (!rule) continue;
    out.push({ id: rule.id, group: rule.group, arch: rule.group === "macos" ? ARCH(a.name) : "", name: a.name, size: a.size || 0, url: a.url, sha256: a.sha256 || "" });
  }
  const order = RULES.map((r) => r.id);
  return out.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id) || (x.arch === "universal" ? -1 : y.arch === "universal" ? 1 : 0));
}

/** Visitor's system from the User-Agent (server side). */
export function detectOS(ua = "") {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Linux|X11|CrOS|BSD/i.test(ua)) return "linux";
  return "other";
}

/** The package to put first for a system, or null (no match, e.g. Android without an APK or an iPhone). */
export function recommend(os, pkgs, ua = "") {
  const by = (id) => pkgs.find((p) => p.id === id);
  if (os === "windows") return by("win-exe") || by("win-msi") || null;
  if (os === "macos") return pkgs.find((p) => p.group === "macos" && p.arch === "universal") || pkgs.find((p) => p.group === "macos") || null;
  if (os === "linux") {
    const arm = /aarch64|arm64|armv8/i.test(ua);
    const order = arm ? ["linux-appimage-arm64", "linux-deb-arm64", "linux-appimage-x64"] : ["linux-appimage-x64", "linux-deb-x64", "linux-appimage-arm64"];
    for (const id of order) if (by(id)) return by(id);
    return pkgs.find((p) => p.group === "linux") || null;
  }
  if (os === "android") return by("android-apk") || null;
  return null;
}

export function formatSize(bytes) {
  if (!bytes) return "";
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}
