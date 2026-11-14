# Changelog

All notable changes to Linkwache. Dates are ISO (YYYY-MM-DD).

## 0.4.0 — 2026-11-14

### Added
- Updater for the self-hosted build. Operator page `/admin` (enabled by setting `ADMIN_TOKEN`; hidden otherwise) shows the
  running version and whether a newer release exists, in all eight languages, light and dark. One click files an update
  request (`update-request.json` in the data directory). The page never installs anything itself.
- `scripts/aktualisieren.sh`: fetches a published release tag, refuses it unless `package.json` carries the tag's version,
  runs its tests, then hands over to `scripts/ausrollen.sh` (backup of source and image, health check, automatic rollback).
  `--if-requested` acts only when the operator page filed a request and removes the request afterwards; `DRY_RUN=1` changes nothing.
- The daily update check records when it last ran (`checkedAt`, visible on the operator page); still switchable with `UPDATE_CHECK=off`.
- Tests: worker API (check, result, pages, share target, health), network failure cases (timeout, redirect loop, invalid
  certificate, failing providers), chat bot webhook (secret, language, per-chat limit), mailbox part with hand-made messages
  and no real credentials, operator page and API (key, rate limit, request file mode), update script against a local repository.

### Fixed
- Mailbox: links that appear only as `href` targets in an HTML mail were dropped together with their tag and never checked.

## 0.3.0 — 2026-11-11

### Added
- `scripts/ausrollen.sh`: one-command rollout to the self-hosted container. Runs the tests, backs up the running source
  and image, swaps the source, builds, restarts, checks `/api/health` (expected version) and the Docker health state,
  and restores the previous version automatically if anything fails.
- Update notice for the operator: once a day the server asks GitHub for a newer release and reports it as `update` in
  `/api/health` and in the log. Never shown on the public pages. Disable with `UPDATE_CHECK=off`.
- Server tests: rate limiter (per minute, per day, stale keys), forged `X-Forwarded-For`, foreign origin, content type,
  body size, `/api/health` version, and the update check.

### Changed
- The rate limiter and the update check live in their own modules (`server/ratelimit.js`, `server/update.js`);
  limits can be overridden with `PER_MINUTE` / `PER_DAY` (defaults unchanged: 10 and 150).
- README and setup guide no longer name a private host; the setup guide is written for any operator.

## 0.2.1 — 2026-10-31

### Added
- `/api/health` now reports the running `version` (read from `package.json`), so monitoring can see which release is live.

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
