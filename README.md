# 🛡️ Linkwache

**Check a suspicious link without opening it — in plain language, in eight languages, no sign-up.**

Paste a link (or the whole WhatsApp message), read the traffic light. Linkwache looks at the link
from the outside — domain age and owner, hiding behind Cloudflare, certificates, short-link targets,
imitated brand names, bait words, the fraud databases of Google Safe Browsing, URLhaus, PhishTank and
urlscan.io — and, if you want, a screenshot taken in the urlscan.io sandbox. The link is never opened
on the user's device.

> **⚠️ Please read before running this for others**
> Linkwache looks for *warning signs*; it does not prove that a page is harmless. A green result is
> "no warning signs found", never "safe". Brand-new scam sites are in no database for their first hours.
> If you host an instance publicly in Germany, you need an Impressum and a privacy page (templates in
> `public/`) — and the third-party APIs it uses (Google Safe Browsing, urlscan.io, PhishTank) have their
> own terms; Safe Browsing in particular is licensed for non-commercial use only.

Deutsch · English · Türkçe · Polski · Русский · Español · Français · Italiano — the language is picked
from the browser, a switch is in the header, and a shared result link renders in the reader's language.

## Hosting

Two ways to run it, same code: a **Cloudflare Worker** (KV, Email Routing) or **self-hosted** as a
Node 22 container behind any reverse proxy (`server/index.js`, `Dockerfile`, `deploy/nas/`). The
Impressum/privacy pages take their personal data from environment variables, never from the repo.
A live instance run by the author for friends: https://linkwache.maro-datacenter01.synology.me

## Ways in

| Channel | How |
|---|---|
| **Web** | paste → check. Works for every messenger and mail client. |
| **Android share sheet** | add the page to the home screen once; it then appears under "Share". |
| **iPhone** | a signed one-tap Shortcut (`/kurzbefehl.html`) puts it in the share sheet. |
| **E-mail** | forward the suspicious mail to `pruefen@<your domain>` (Cloudflare Email Routing → this Worker; Cloudflare variant only). |
| **Telegram** | forward the message to your bot. |

## Stack

One Cloudflare Worker (`src/index.js`) with static assets, a KV namespace for results (90 days,
random IDs, no personal data), a rate limit keyed on a daily-salted hash of the IP, an Email Worker
handler and a Telegram webhook. No cookies, no analytics, no server to maintain.

```
src/checks.js   heuristics + lookups (DNS over HTTPS, RDAP, crt.sh, Safe Browsing, URLhaus, PhishTank, urlscan.io)
src/verdict.js  scoring, known scam patterns (voting, parcel, bank)
src/i18n.js     every user-facing string in eight languages; findings are stored as keys and translated at render time
src/render.js   pages, result card, text for bot and mail
public/         styles, client script, legal pages, share-target manifest
test/           node --test
```

## Run locally

```
npm install
npm test
npx wrangler dev        # http://localhost:8788 — network lookups are live, sandbox/Safe Browsing need keys in .dev.vars
```

## Deploy

See **[SETUP.md](SETUP.md)** — a step-by-step guide (Cloudflare account, domain, KV, secrets, Email
Routing, Telegram bot, Safe Browsing and urlscan keys, PayPal button, Impressum).

## License

Source-available — see [LICENSE](LICENSE). All rights reserved; free to run for yourself, not to
redistribute or host for others without permission.
