// Seiten und Textfassungen — alles übersetzt zur Anzeigezeit.
import { esc, defang } from "./util.js";
import { STUFE_EMOJI } from "./verdict.js";
import { t, findingText, verdictText, LANGS, LANG_NAMES } from "./i18n.js";
import { PAGES } from "./i18n_pages.js";

/** Spendenlink: PayPal.me-Name oder eine PayPal-Mailadresse (klassischer Zahlungslink, geht mit jedem Konto). */
export function paypalLink(env) {
  if (env.PAYPAL_ME) return "https://paypal.me/" + encodeURIComponent(env.PAYPAL_ME);
  if (env.PAYPAL_MAIL) return "https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=" + encodeURIComponent(env.PAYPAL_MAIL) + "&item_name=" + encodeURIComponent("Linkwache — Kaffee") + "&currency_code=EUR";
  return "";
}

function langSwitch(lang, path) {
  return `<select class="lang" aria-label="Language" onchange="location.href='${esc(path)}?lang='+this.value">` +
    LANGS.map((l) => `<option value="${l}"${l === lang ? " selected" : ""}>${LANG_NAMES[l]}</option>`).join("") + `</select>`;
}

export function page({ lang, title, body, env, noindex = false, extraHead = "", path = "/", client = {} }) {
  const cfg = { lang, ...client, s: { checking: t(lang, "home.checking"), check: t(lang, "home.check"), copied: t(lang, "r.copied"), copy: t(lang, "r.copy"),
    wait: t(lang, "wait.check"), clip: t(lang, "err.clip"), net: t(lang, "err.net"), fail: t(lang, "err.fail") } };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(t(lang, "site.desc"))}">
${noindex ? '<meta name="robots" content="noindex">' : LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(env.SITE_URL)}${esc(path)}?lang=${l}">`).join("")}
<link rel="stylesheet" href="/style.css?v=${esc(env.ASSET_VER || "1")}"><script src="/theme.js?v=${esc(env.ASSET_VER || "1")}"></script><link rel="icon" href="/icon.svg"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0c0d16">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(t(lang, "site.desc"))}">
${extraHead}<script>window.LW=${JSON.stringify(cfg)}</script></head><body>
<header class="top"><a class="brand" href="/?lang=${lang}"><span class="wappen"><img src="/icon.svg" alt=""></span><span>${esc(env.SITE_NAME || "Linkwache")}<small>${esc(t(lang, "site.tagline"))}</small></span></a>
<nav><a href="/?lang=${lang}#so-gehts">${esc(t(lang, "nav.how"))}</a><a href="/impressum.html">${esc(t(lang, "nav.legal"))}</a><button class="theme" id="theme" type="button" aria-label="Theme">🌙</button>${langSwitch(lang, path)}</nav></header>
<main>${body}</main>
<footer><p>${esc(t(lang, "foot.note"))}</p>
${paypalLink(env) ? `<p><a class="btn coffee" href="${esc(paypalLink(env))}" rel="noopener" target="_blank">${esc(t(lang, "foot.coffee"))}</a></p>` : ""}
<p class="small"><a href="/impressum.html?lang=${lang}">${esc(t(lang, "nav.legal"))}</a> · <a href="/datenschutz.html?lang=${lang}">${esc(t(lang, "foot.privacy"))}</a> · <a href="https://github.com/robeertm/linkwache" rel="noopener">${esc(t(lang, "foot.source"))}</a></p></footer>
<script src="/app.js?v=${esc(env.ASSET_VER || "1")}" defer></script></body></html>`;
}

export function homePage(lang, env) {
  const mail = env.CONTACT_MAIL || ("pruefen@" + String(env.SITE_URL || "linkwache.de").replace(/^https?:\/\//, ""));
  const bot = env.TELEGRAM_BOT ? `<a href="https://t.me/${esc(env.TELEGRAM_BOT)}" rel="noopener">@${esc(env.TELEGRAM_BOT)}</a>` : "Telegram";
  const step = (h, p) => `<div class="step"><h3>${esc(t(lang, h))}</h3><p>${p}</p></div>`;
  const body = `
  <h1>${esc(t(lang, "home.h1"))}</h1>
  <p class="lead">${esc(t(lang, "home.lead"))}</p>
  <form class="paste" id="form">
    <label for="url" class="small">${esc(t(lang, "home.label"))}</label>
    <textarea id="url" name="url" placeholder="${esc(t(lang, "home.placeholder"))}" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
    <div class="row"><button class="btn big" id="go" type="submit">${esc(t(lang, "home.check"))}</button>
    <button class="btn ghost" id="pastebtn" type="button">${esc(t(lang, "home.paste"))}</button></div>
    <p class="hint">${esc(t(lang, "home.hint"))}</p>
  </form>
  <div id="out" class="result" hidden></div>
  <section id="so-gehts">
    <h2>${esc(t(lang, "home.how.h"))}</h2>
    <div class="steps">${step("home.s1.h", esc(t(lang, "home.s1.p")))}${step("home.s2.h", esc(t(lang, "home.s2.p")))}${step("home.s3.h", esc(t(lang, "home.s3.p")))}</div>
    <h2>${esc(t(lang, "home.fast.h"))}</h2>
    <div class="steps">
      ${step("home.android.h", esc(t(lang, "home.android.p")))}
      ${step("home.ios.h", esc(t(lang, "home.ios.p")) + ` <a href="/kurzbefehl.html?lang=${lang}">${esc(t(lang, "home.ios.link"))}</a>`)}
      ${env.MAIL_IN !== "off" ? step("home.mail.h", esc(t(lang, "home.mail.p", { mail: "{m}" })).replace("{m}", `<a href="mailto:${esc(mail)}">${esc(mail)}</a>`)) : ""}
      ${env.TELEGRAM_BOT ? step("home.tg.h", esc(t(lang, "home.tg.p", { bot: "{b}" })).replace("{b}", bot)) : ""}
    </div>
    <h2>${esc(t(lang, "home.what.h"))}</h2>
    <p class="small">${esc(t(lang, "home.what.p"))}</p>
  </section>`;
  return page({ lang, title: `${env.SITE_NAME || "Linkwache"} — ${t(lang, "site.tagline")}`, body, env, path: "/" });
}

export function resultCard(r, env, lang) {
  const v = verdictText(lang, r.verdict);
  const f = r.findings || [];
  const scan = r.scan || {};
  const shareUrl = `${env.SITE_URL}/r/${r.id}`;
  const facts = r.facts || {};
  const rd = facts.rdap || {};
  const dns = facts.dns || {};
  const li = f.map((x) => { const tx = findingText(lang, x); return `<li class="f ${x.stufe}"><span class="dot"></span><div><b>${esc(tx.titel)}</b>${esc(tx.text)}</div></li>`; }).join("");
  const scanBlock = scan.status === "done" && !scan.screenshot
    ? `<div class="pending noshot">${esc(t(lang, "r.noshot"))}${scan.loadError ? " " + esc(t(lang, "r.noshot.err", { e: scan.loadError })) : ""} <a href="${esc(scan.reportUrl)}" rel="noopener" target="_blank">${esc(t(lang, "r.shot.report"))}</a></div>`
    : scan.status === "done"
    ? `<figure class="shot"><img src="${esc(scan.screenshot)}" alt="Screenshot" loading="lazy">
       <figcaption>${esc(t(lang, "r.shot"))}${scan.title ? " " + esc(t(lang, "r.shot.title", { t: scan.title })) : ""}${scan.country ? " " + esc(t(lang, "r.shot.server", { c: scan.country })) : ""} <a href="${esc(scan.reportUrl)}" rel="noopener" target="_blank">${esc(t(lang, "r.shot.report"))}</a></figcaption></figure>`
    : scan.status === "pending" ? `<div class="pending" data-poll="${esc(r.id)}">${esc(t(lang, "r.pending"))}</div>`
      : scan.status === "timeout" ? `<div class="pending">${esc(t(lang, "r.timeout"))}</div>` : "";
  const dbTxt = (x, fn) => (!x || x.error) ? t(lang, "r.na") : x.skipped ? t(lang, "r.notsetup") : !x.ok ? t(lang, "r.na") : fn(x);

  return `<section class="verdict ${r.verdict.stufe}">
<div class="ampel">${STUFE_EMOJI[r.verdict.stufe]}</div>
<div><div class="stufe">${esc(v.stufe)}</div><h1>${esc(v.kurz)}</h1><p class="rat">${esc(v.rat)}</p></div>
</section>
<p class="url"><span class="lbl">${esc(t(lang, "r.checked"))}</span> <code>${esc(defang(r.url))}</code>${r.chain && r.chain.length > 1 ? `<br><span class="small">${esc(t(lang, "r.unwrapped"))}: ${r.chain.map(defang).map(esc).join(" → ")}</span>` : ""}</p>
<ul class="findings">${li}</ul>
${scanBlock}
<details class="facts"><summary>${esc(t(lang, "r.facts"))}</summary><table>
<tr><td>${esc(t(lang, "r.domain"))}</td><td>${esc(r.host.domain)}${r.host.sub ? ` (${esc(t(lang, "r.subdomain"))}: ${esc(r.host.sub)})` : ""}</td></tr>
<tr><td>${esc(t(lang, "r.registered"))}</td><td>${rd.created ? esc(String(rd.created).slice(0, 10)) : esc(t(lang, "r.unknown"))}${rd.registrar ? " · " + esc(rd.registrar) : ""}</td></tr>
<tr><td>${esc(t(lang, "r.ips"))}</td><td>${(dns.ips || []).map(esc).join(", ") || esc(t(lang, "r.none"))}${dns.cloudflare ? " (Cloudflare)" : ""}</td></tr>
<tr><td>${esc(t(lang, "r.ns"))}</td><td>${(dns.ns || []).map(esc).join(", ") || "–"}</td></tr>
<tr><td>${esc(t(lang, "r.mx"))}</td><td>${(dns.mx || []).length ? esc(t(lang, "r.present")) : esc(t(lang, "r.none"))}</td></tr>
<tr><td>${esc(t(lang, "r.certs"))}</td><td>${facts.ct?.ok ? (facts.ct.count ? esc(t(lang, "r.certs.n", { n: facts.ct.count, d: String(facts.ct.first).slice(0, 10) })) : esc(t(lang, "r.none"))) : esc(t(lang, "r.na"))}</td></tr>
<tr><td>${esc(t(lang, "r.dbs"))}</td><td>Safe Browsing: ${dbTxt(facts.safebrowsing, (x) => t(lang, x.matches?.length ? "r.hit" : "r.nohit"))} · URLhaus: ${dbTxt(facts.urlhaus, (x) => t(lang, x.listed ? "r.listed" : "r.nohit"))} · PhishTank: ${dbTxt(facts.phishtank, (x) => t(lang, x.listed ? "r.listed" : "r.nohit"))} · urlscan: ${dbTxt(facts.urlscanSearch, (x) => x.total ? t(lang, "r.scans", { n: x.total }) : t(lang, "r.noscans"))}</td></tr>
<tr><td>${esc(t(lang, "r.when"))}</td><td>${esc(String(r.checked).replace("T", " ").slice(0, 16))} UTC</td></tr>
</table>${facts.safebrowsing?.ok ? `<p class="small">Safe Browsing: <a href="https://developers.google.com/safe-browsing/v4/advisory" rel="noopener" target="_blank">Advisory provided by Google</a>.</p>` : ""}</details>
<div class="share"><input id="share" readonly value="${esc(shareUrl)}"><button class="btn" data-copy="#share">${esc(t(lang, "r.copy"))}</button>
<a class="btn ghost" href="https://wa.me/?text=${encodeURIComponent(t(lang, "r.wa.text", { kurz: v.kurz, url: shareUrl }))}" rel="noopener" target="_blank">${esc(t(lang, "r.wa"))}</a></div>`;
}

/** Kurzfassung für Telegram und Mail. */
export function resultText(r, env, lang) {
  const v = verdictText(lang, r.verdict);
  const lines = [
    `${STUFE_EMOJI[r.verdict.stufe]} ${v.stufe.toUpperCase()} — ${v.kurz}`, ``,
    t(lang, "txt.checked", { url: defang(r.url) }), ``,
    ...r.findings.filter((f) => f.stufe === "rot" || f.stufe === "gelb").slice(0, 5).map((f) => `${f.stufe === "rot" ? "‼️" : "⚠️"} ${findingText(lang, f).titel}`),
    ``, v.rat, ``,
    t(lang, "txt.details", { url: `${env.SITE_URL}/r/${r.id}?lang=${lang}` }),
  ];
  return lines.join("\n");
}


/** Unterseiten-Text: HTML erlaubt (aus dem Quelltext), Platzhalter werden escaped eingesetzt. */
function tp(lang, key, env, extra = {}) {
  const d = PAGES[lang] || PAGES.de;
  let s = d[key] ?? PAGES.de[key] ?? key;
  const site = String(env.SITE_URL || "").replace(/\/$/, "");
  const vals = { lang, site, host: site.replace(/^https?:\/\//, ""), mail: env.CONTACT_MAIL || "", place: env.LEGAL_PLACE || env.LEGAL_CITY || "Deutschland", ...extra };
  for (const [k, v] of Object.entries(vals)) s = s.split("{" + k + "}").join(k === "lang" ? v : esc(String(v)));
  return s;
}

export function legalPage(lang, env) {
  const name = env.LEGAL_NAME || "[Name eintragen]", street = env.LEGAL_STREET || "[Straße eintragen]", city = env.LEGAL_CITY || "[PLZ Ort eintragen]";
  const body = `<div class="legal">
  <h1>${tp(lang, "legal.h1", env)}</h1>
  <p>${tp(lang, "legal.intro", env)}</p>
  <p><b>${esc(name)}</b><br>${esc(street)}<br>${esc(city)}<br>Deutschland</p>
  ${env.CONTACT_MAIL ? `<p>${tp(lang, "legal.mail", env)}: <a href="mailto:${esc(env.CONTACT_MAIL)}">${esc(env.CONTACT_MAIL)}</a></p>` : ""}
  <h2>${tp(lang, "legal.note.h", env)}</h2><p>${tp(lang, "legal.note.p1", env)}</p><p>${tp(lang, "legal.note.p2", env)}</p>
  <h2>${tp(lang, "legal.services.h", env)}</h2><p>${tp(lang, "legal.services.p", env)}</p>
  </div>`;
  return page({ lang, title: `${tp(lang, "legal.title", env)} · ${env.SITE_NAME || "Linkwache"}`, body, env, noindex: true, path: "/impressum.html" });
}

export function privacyPage(lang, env) {
  const P = (k) => tp(lang, k, env);
  const body = `<div class="legal">
  <h1>${P("privacy.h1")}</h1><p>${P("privacy.resp")}</p>
  <h2>${P("privacy.host.h")}</h2><p>${P("privacy.host.p")}</p>
  <h2>${P("privacy.store.h")}</h2><ul><li>${P("privacy.store.1")}</li><li>${P("privacy.store.2")}</li><li>${P("privacy.store.3")}</li></ul>
  <h2>${P("privacy.logs.h")}</h2><p>${P("privacy.logs.p")}</p>
  <h2>${P("privacy.flow.h")}</h2><p>${P("privacy.flow.p")}</p><ul><li>${P("privacy.flow.1")}</li><li>${P("privacy.flow.2")}</li><li>${P("privacy.flow.3")}</li><li>${P("privacy.flow.4")}</li><li>${P("privacy.flow.5")}</li></ul><p>${P("privacy.basis")}</p>
  <h2>${P("privacy.paypal.h")}</h2><p>${P("privacy.paypal.p")}</p>
  <h2>${P("privacy.cookies.h")}</h2><p>${P("privacy.cookies.p")}</p>
  <h2>${P("privacy.rights.h")}</h2><p>${P("privacy.rights.p")}</p>
  <p class="small">${P("privacy.stand")}</p></div>`;
  return page({ lang, title: `${P("privacy.title")} · ${env.SITE_NAME || "Linkwache"}`, body, env, noindex: true, path: "/datenschutz.html" });
}

export function shortcutPage(lang, env) {
  const P = (k) => tp(lang, k, env);
  const body = `<div class="legal">
  <h1>${P("sc.h1")}</h1><p class="lead">${P("sc.lead")}</p>
  <div class="paste"><h3 style="margin:0 0 .4rem">${P("sc.onetap.h")}</h3><p class="small" style="margin:0 0 .8rem">${P("sc.onetap.p")}</p>
  <div class="row"><a class="btn big" href="/Linkwache.shortcut" download="Linkwache.shortcut">${P("sc.onetap.btn")}</a></div>
  <p class="hint">${P("sc.onetap.hint")}</p></div>
  <h2>${P("sc.manual.h")}</h2>
  <div class="steps"><div class="step"><h3>${P("sc.s1.h")}</h3><p>${P("sc.s1.p")}</p></div><div class="step"><h3>${P("sc.s2.h")}</h3><p>${P("sc.s2.p")}</p></div><div class="step"><h3>${P("sc.s3.h")}</h3><p>${P("sc.s3.p")}</p></div></div>
  <p class="small">${P("sc.after")}</p>
  <p><a class="btn ghost" href="/?lang=${lang}">${P("sc.back")}</a></p></div>`;
  return page({ lang, title: `${P("sc.title")} · ${env.SITE_NAME || "Linkwache"}`, body, env, path: "/kurzbefehl.html" });
}

export function notFoundPage(lang, env) {
  const P = (k) => tp(lang, k, env);
  const body = `<div class="legal"><h1>${P("nf.h1")}</h1><p>${P("nf.p")}</p><p><a class="btn" href="/?lang=${lang}">${P("nf.back")}</a></p></div>`;
  return page({ lang, title: `${P("nf.title")} · ${env.SITE_NAME || "Linkwache"}`, body, env, noindex: true, path: "/" });
}
