// chrome.storage.local wrapper: settings, allowlist, cache, log, install id.
import { api } from "./api.js";

export const DEFAULTS = { server: typeof LW_DEFAULT_SERVER === "string" ? LW_DEFAULT_SERVER : "", scope: "url", paused: false, lang: "auto" };

export async function getAll() {
  const r = await api.storage.local.get(["settings", "allow", "cache", "log", "install"]);
  return { settings: { ...DEFAULTS, ...(r.settings || {}) }, allow: r.allow || [], cache: r.cache || {}, log: r.log || [], install: r.install || "" };
}
export const set = (o) => api.storage.local.set(o);

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function installId() {
  const { install } = await api.storage.local.get("install");
  if (/^[0-9a-f]{32}$/.test(install || "")) return install;
  const id = randomHex(16);
  await api.storage.local.set({ install: id });
  return id;
}

export function validServer(s) {
  if (!s) return false;
  try { const u = new URL(s); return (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) && !u.search && !u.hash; } catch { return false; }
}
