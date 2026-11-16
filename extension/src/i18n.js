// Runtime texts: the build generates "lw-strings" from src/i18n.js (ext.*, f.*, pat.*, v.*, stufe.*, age.*).
import { STRINGS, LANGS } from "lw-strings";
export { LANGS };

export function pickLang(setting, browserLang = "en") {
  if (setting && setting !== "auto" && LANGS.includes(setting)) return setting;
  const c = String(browserLang || "").toLowerCase().slice(0, 2);
  return LANGS.includes(c) ? c : "en";
}

export function t(lang, key, p = {}) {
  const d = STRINGS[lang] || STRINGS.en;
  let s = d[key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(p)) s = s.split("{" + k + "}").join(String(v));
  return s;
}

/** Finding (key, stufe, p) -> translated title and text, with the server's own wording as a fallback for unknown keys. */
export function findingView(lang, f) {
  const k = (f.muster || (!STRINGS.en["f." + f.key] && STRINGS.en["pat." + f.key]) ? "pat." : "f.") + f.key;
  if (!STRINGS.en[k]) return { titel: f.titel || f.key, text: f.text || "" };
  const p = f.p || {};
  if (f.key === "age-fresh") return { titel: t(lang, "f.age-fresh", { age: p.days === 0 ? t(lang, "age.hours") : t(lang, "age.days", { n: p.days }) }), text: t(lang, "f.age-fresh.t") };
  if (f.key === "phishtank") return { titel: t(lang, k, p), text: t(lang, p.verified ? "f.phishtank.t.v" : "f.phishtank.t.u") };
  if (f.key === "urlscan-verdict") return { titel: t(lang, k, p), text: t(lang, p.brands ? "f.urlscan-verdict.b" : "f.urlscan-verdict.t", p) };
  return { titel: t(lang, k, p), text: t(lang, k + ".t", p) };
}
