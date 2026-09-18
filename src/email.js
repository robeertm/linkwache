// Mail-Eingang: eine verdächtige Mail an pruefen@<domain> weiterleiten, die
// Antwort kommt automatisch. Läuft über Cloudflare Email Routing → dieser
// Worker. Wir lesen nur Links aus Text und HTML, speichern die Mail nicht und
// antworten dem Absender per message.reply().
import PostalMime from "postal-mime";
import { createMimeMessage } from "mimetext";
import { EmailMessage } from "cloudflare:email";
import { extractUrls } from "./util.js";
import { t, LANGS, DEFAULT_LANG } from "./i18n.js";

const TTL = 90 * 86400;

export async function handleEmail(message, env, ctx, { runCheck, resultText }) {
  const raw = await new Response(message.raw).arrayBuffer();
  const mail = await new PostalMime().parse(raw);
  const text = [mail.subject, mail.text, stripHtml(mail.html || "")].filter(Boolean).join("\n");
  // Links, die auf unsere eigene Seite zeigen, sind kein Prüfgegenstand.
  const site = (env.SITE_URL || "").replace(/^https?:\/\//, "");
  const urls = extractUrls(text).filter((u) => !site || !u.includes(site)).slice(0, 5);
  // Sprache: Content-Language der Mail, sonst grobe Erkennung am Text, sonst Standard.
  const cl = String(message.headers.get("content-language") || "").slice(0, 2).toLowerCase();
  const lang = LANGS.includes(cl) ? cl : guessLang(text);

  let body;
  if (!urls.length) {
    body = t(lang, "mail.nolink");
  } else {
    const parts = [];
    for (const u of urls) {
      try {
        const r = await runCheck(u, env, { withScan: true });
        if (r.error) { parts.push(t(lang, r.error)); continue; }
        await env.RESULTS.put("r:" + r.id, JSON.stringify(r), { expirationTtl: TTL });
        parts.push(resultText(r, env, lang));
      } catch (e) {
        parts.push("Prüfung fehlgeschlagen für " + u + ": " + String(e).slice(0, 100));
      }
    }
    body = (urls.length === 1 ? t(lang, "mail.intro1") : t(lang, "mail.intron", { n: urls.length })) +
      parts.join("\n\n──────────\n\n") +
      t(lang, "mail.outro", { site: env.SITE_URL }) +
      (env.CONTACT_MAIL ? t(lang, "mail.contact", { mail: env.CONTACT_MAIL }) : "");
  }

  const msg = createMimeMessage();
  msg.setSender({ name: env.SITE_NAME || "Linkwache", addr: message.to });
  msg.setRecipient(message.from);
  msg.setSubject("Re: " + (mail.subject || t(lang, "mail.re")));
  const mid = message.headers.get("message-id");
  if (mid) msg.setHeader("In-Reply-To", mid);
  msg.addMessage({ contentType: "text/plain", data: body });
  await message.reply(new EmailMessage(message.to, message.from, msg.asRaw()));
}

/** Grobe Spracherkennung an häufigen Wörtern — reicht für die Antwortsprache. */
function guessLang(text) {
  const s = " " + String(text || "").toLowerCase().slice(0, 3000) + " ";
  const hints = {
    en: [" the ", " and ", " please ", " you ", " this "], de: [" und ", " nicht ", " bitte ", " ich ", " der ", " die "],
    tr: [" ve ", " bir ", " için ", " lütfen "], pl: [" nie ", " jest ", " proszę ", " się "], ru: [" и ", " не ", " это ", " пожалуйста "],
    es: [" el ", " que ", " por favor ", " los "], fr: [" le ", " les ", " vous ", " s’il "], it: [" il ", " che ", " per favore ", " non "],
  };
  let best = DEFAULT_LANG, bestN = 0;
  for (const [l, ws] of Object.entries(hints)) {
    const n = ws.reduce((a, w) => a + (s.split(w).length - 1), 0);
    if (n > bestN) { best = l; bestN = n; }
  }
  return bestN >= 2 ? best : DEFAULT_LANG;
}

function stripHtml(h) {
  // href-Ziele sichtbar machen, dann Tags entfernen
  return String(h).replace(/href\s*=\s*["']([^"']+)["']/gi, " $1 ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
}
