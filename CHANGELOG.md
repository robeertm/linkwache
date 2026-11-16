# Changelog

All notable changes to Linkwache. Dates are ISO (YYYY-MM-DD).

## 0.5.0 — unreleased

### Added — Android app
- Android app (`android/`, Android 8.0+): chosen as the default browser app, it checks every tapped web link (mail,
  messengers, text messages, PDFs) before it opens and hands it to the real browser picked during setup — always with
  an explicit package name, so a link can never loop back. Also "Share → Check with Linkwache" and the text selection menu.
- Check sheet over the calling app: "checking", "No warning signs – opening" (opens after ~0.7 s), suspicious (findings
  in plain language, "Open anyway" active after 3 s), dangerous (blocked; opening only via a deliberate second step),
  "Could not be checked" (reason and local assessment; nothing opens on its own; a locally red link stays blocked).
- Check flow shared with the desktop app: link wrappers unwrapped locally, offline heuristics ported to Kotlin and
  pinned by the shared test vectors, allowlist (never matching look-alikes), on-device cache, `POST /api/v1/check` with a
  hard 6 s timeout. Query string and fragment never leave the phone; "Domain only" sends just the host.
- Custom Tabs: Linkwache answers the default browser's tab service (without preloading anything), so links that apps
  show in a Custom Tab are checked too and then open as a Custom Tab of the real browser.
- Setup assistant (five steps) that requests the browser role through Android's own dialog and verifies the result;
  settings for browser, server, privacy scope, pause, allowlist, local history (last 200) and installation ID.
- Updater from the first version: notice when the GitHub release marked "latest" carries a newer APK (switchable);
  one tap downloads it, verifies SHA-256, package name, version and the signing certificate, then hands it to the
  system installer. Settings are kept.
- Eight languages; verdict and finding texts are generated from the server translations, a test fails on missing texts.
- CI (`.github/workflows/android.yml`): unit and Robolectric tests, lint, unsigned release build, end-to-end test on an
  Android 14 emulator with a stand-in server and browser, screenshots of every state (light/dark, phone/tablet).
  The release APK is signed outside CI (`android/scripts/sign-release.sh`); see `docs/ANDROID.md`.

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
