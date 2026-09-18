// Telegram-Bot: Nachricht (oder weitergeleitete Nachricht) an den Bot → Links
// werden geprüft, die Antwort kommt als Kurzfassung mit Ergebnis-Link.
// Einrichten: SETUP.md, Abschnitt Telegram. Der Webhook wird mit einem
// Geheimnis (TELEGRAM_SECRET) gesetzt; ohne das richtige Geheimnis antwortet
// dieser Handler mit 403 — sonst könnte jeder den Bot in unserem Namen füttern.
import { extractUrls } from "./util.js";
import { t, LANGS, DEFAULT_LANG } from "./i18n.js";

const TTL = 90 * 86400;

export async function handleTelegram(req, env, ctx, { runCheck, resultText }) {
  if (!env.TELEGRAM_TOKEN) return new Response("Telegram nicht eingerichtet", { status: 404 });
  if (env.TELEGRAM_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let upd = {};
  try { upd = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  const msg = upd.message || upd.edited_message || upd.channel_post;
  if (!msg) return new Response("ok");
  const chat = msg.chat?.id;
  const lc = String(msg.from?.language_code || "").slice(0, 2).toLowerCase();
  const lang = LANGS.includes(lc) ? lc : DEFAULT_LANG;
  const text = [msg.text, msg.caption, ...(msg.entities || []).filter((e) => e.type === "text_link").map((e) => e.url)].filter(Boolean).join("\n");

  if (/^\/start\b/.test(text || "")) {
    await send(env, chat, t(lang, "tg.start"));
    return new Response("ok");
  }
  const urls = extractUrls(text || "");
  if (!urls.length) {
    await send(env, chat, t(lang, "tg.nolink"));
    return new Response("ok");
  }
  // Antwort sofort, Prüfung im Hintergrund — Telegram wartet höchstens ein paar Sekunden.
  ctx.waitUntil((async () => {
    for (const u of urls.slice(0, 3)) {
      try {
        const r = await runCheck(u, env);
        if (r.error) { await send(env, chat, t(lang, r.error)); continue; }
        await env.RESULTS.put("r:" + r.id, JSON.stringify(r), { expirationTtl: TTL });
        await send(env, chat, resultText(r, env, lang));
      } catch (e) {
        await send(env, chat, t(lang, "tg.fail", { e: String(e).slice(0, 120) }));
      }
    }
  })());
  await send(env, chat, urls.length === 1 ? t(lang, "tg.wait1") : t(lang, "tg.waitn", { n: Math.min(urls.length, 3) }));
  return new Response("ok");
}

async function send(env, chat, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
}
