# Changelog

All notable changes to Linkwache. Dates are ISO (YYYY-MM-DD).

## 0.2.0 — 2026-10-16

### Security
- **Rate limits can't be bypassed any more.** The self-hosted server took the sender's address from the first
  `X-Forwarded-For` entry, which the sender controls. It now uses the address the reverse proxy sets (`X-Real-IP`),
  and IPv6 addresses count per /64.
- Daily limit per sender in addition to the per-minute limit (10 per minute, 150 per day).
- Daily budget for sandbox scans (`SCANS_PER_DAY`, default 200); after that, links are checked without the sandbox.
- No inline JavaScript any more: the content security policy no longer allows `'unsafe-inline'`, and the result page
  passes its data as JSON. A crafted result link could previously run script on the page.
- Requests from other websites are rejected, and the API only accepts JSON.
- Request bodies are limited while they are read (a huge request could exhaust memory).
- Telegram bot: requires the webhook secret, limits checks per chat per day (counted as a hash, never the chat ID
  itself) and no longer sends internal error text to the chat.
- Error responses are generic; details go to the server log only.

### Changed
- Privacy policy (all eight languages): requests are counted per minute and per day; Telegram messages are counted
  per chat for one day. Last updated 2026-10-16.

## 0.1.0 — 2026-09-18 to 2026-09-19

### Added
- Check a suspicious link without opening it: traffic light in plain language, eight languages, no sign-up.
- Sub-pages (legal notice, privacy, shortcut, 404) in all eight languages; day and night mode.
- Self-hosted server with gzip responses and daily traffic counters.
