// chrome.storage.local wrapper: settings, allowlist, cache, log, install id.
import { api } from "./api.js";
import { normServer, parsePresetList, applyPreset } from "./preset.js";

/** Built-in server address and earlier ones to move away from (build-time, see scripts/build.mjs). */
export const PRESET = normServer(typeof LW_DEFAULT_SERVER === "string" ? LW_DEFAULT_SERVER : "");
export const PRESET_MIGRATE_FROM = parsePresetList(typeof LW_PRESET_MIGRATE_FROM === "string" ? LW_PRESET_MIGRATE_FROM : "", PRESET);

export const DEFAULTS = { server: PRESET, serverPreset: PRESET, scope: "url", paused: false, lang: "auto" };

export async function getAll() {
  const r = await api.storage.local.get(["settings", "allow", "cache", "log", "install"]);
  const stored = r.settings || {};
  const settings = { scope: "url", paused: false, lang: "auto", ...stored };
  if (applyPreset(settings, PRESET, PRESET_MIGRATE_FROM)) await api.storage.local.set({ settings });
  return { settings, allow: r.allow || [], cache: r.cache || {}, log: r.log || [], install: r.install || "" };
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

/** A fresh install id, stored (the server refused the old one: self-healing, see client.js). */
export async function renewInstallId() {
  const id = randomHex(16);
  await api.storage.local.set({ install: id });
  return id;
}

/** The address checks go to: the stored one, or the built-in preset while the field is empty. */
export function effectiveServer(settings, preset = PRESET) {
  const s = String((settings && settings.server) || "").trim();
  return s || preset || "";
}

export function validServer(s) {
  if (!s) return false;
  try { const u = new URL(s); return (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) && !u.search && !u.hash; } catch { return false; }
}
