# Changelog

All notable changes to Linkwache. Dates are ISO (YYYY-MM-DD).

## 0.5.3 — 2026-11-16

### Fixed — server
- False alarm on real sites: a fraud list now makes a link red only when it names exactly this URL (scheme ignored,
  host lower case, path and query as reported). PhishTank still lists the plain start page of a large payment
  provider from 2016 as a verified phish, and that entry turned every check of the site red. Start pages of
  well-known sites (popularity list plus banks, payment, parcel and public services) listed in a fraud list are now
  an informational "outdated entry"; phishing pages hosted on big platforms stay red because they are exact URLs.
- URLhaus is asked for the exact URL as well; its host lookup and urlscan.io verdicts for other pages of the same
  domain are a hint (amber, on well-known sites info), never red on their own.
- `http://` links to well-known sites are an informational hint instead of amber.
- Results carry a rules version (`rules` in `/api/v1/check` and `/api/health`); the server cache never reuses results
  of older rules.
- Download page: the release date is shown in the reader's language (for example `16. Nov. 2026`, `Nov 16, 2026`)
  instead of ISO, in the version line and on every package card, in all 8 languages (`Intl`, UTC so the day never
  shifts).

## 0.5.2 — 2026-11-16

### Fixed
- Desktop app, browser extension and Android app follow the built-in server address instead of freezing it: the
  desktop settings and the extension storage now record whether the address is the preset. When a release ships a
  new preset, installations that follow it move along; an address the user entered stays untouched.
  Installations from 0.5.0/0.5.1 move from the earlier presets listed in the build-time variable
  `LINKWACHE_PRESET_MIGRATE_FROM` (repository variable, never in the source). On Android a stored copy of an earlier
  preset is dropped at start.
- The browser extension packages of 0.5.0/0.5.1 were built without the preset server address; the release job now
  passes it (and the migration list) to the extension build. An empty address from those packages gets the preset.
- Pages name the configured public address only: new `rel="canonical"`, `hreflang` (plus `x-default`) and
  `og:url` come from `PUBLIC_URL` (the older `SITE_URL` still works).
- Outgoing requests (link shortener lookups, page fetches) name the project page in the user agent instead of a
  domain that is not part of the project.

### Added
- `LEGACY_HOSTS` (operator setting): HTML pages requested under an earlier host name answer 301 to the public
  address. The API, the Telegram webhook, the admin page and all files are never redirected, so installed apps keep
  working with the address they were built with.
- The Android release smoke test confirms the green check came from the preset server (compared as a hash, the
  address never appears in logs).

## 0.5.1 — 2026-11-16

### Changed
- Download page: heading and introduction name the Android app as well (an Android visitor is offered the APK and
  read "for your computer" before), in all eight languages.
- The server looks for new release files every 3 hours instead of once a day, so files attached after a release (the
  Android APK, notarised macOS builds) appear on the download page soon.

### Fixed
- Rollout and update scripts run on GNU systems too (`mktemp` templates); the APK publishing script works with older
  GitHub CLI versions.

## 0.5.0 — 2026-11-16

### Added — Desktop app (Windows, macOS, Linux)
- Background app (`desktop/`, Tauri 2) that becomes the system's handler for web links in the "browser picker" pattern:
  every link clicked in a mail program, office document, PDF or messenger is checked first and then handed to the
  browser chosen during setup (never back to the system default, so links cannot loop). Only `http`/`https` links are
  checked; local HTML files pass through, other schemes are never taken over.
- Check notice in a screen corner ("Linkwache is checking … *domain*" → "No warning signs – opening"); warning window
  with the findings in plain language: suspicious links can be opened after a warning ("Open anyway" active after
  3 s), dangerous links are blocked and open only through a deliberate second step (logged locally), "Could not be
  checked" when the server is unreachable — nothing ever opens silently.
- Fast path: allowlist with look-alike protection, on-device cache, offline heuristics (Rust port pinned by shared test
  vectors), local unwrapping of mail link wrappers (Safe Links, Google, Facebook, Instagram, YouTube, Slack, LinkedIn).
- Setup assistant (language, server, forward browser, default handler per system with verification, native-messaging
  hosts, autostart), settings (server, privacy scope, browser, allowlist, history, pause, updates, language), tray icon
  with status and menu. Windows: per-user browser registration, the assistant opens *Default apps* and verifies the
  user's choice; XML for DISM/GPO default associations. macOS: confirmation dialog via Launch Services. Linux:
  `xdg-settings`/`xdg-mime`.
- Updater from the first version: signed update manifests (verified before anything is replaced, independent of
  code signing), one-click install from tray or settings, backup of the previous version, settings kept, check
  switchable.
- CI (`.github/workflows/desktop.yml`): builds for Windows (NSIS, MSI), macOS (universal DMG), Linux x64/arm64
  (AppImage, deb, rpm); `cargo test`; end-to-end tests on real Windows, macOS and Linux runners (links opened through
  the system, a fake browser records what arrives: green opens, red stays blocked, amber after the delay, offline opens
  nothing), once against a stand-in and once against the real server; native screenshots. Release job attaches all
  packages, `latest.json` and `SHA256SUMS.txt` to a pre-release. Hooks for Windows code signing and macOS
  notarisation (see `docs/DESKTOP.md`, `desktop/README.md`).

### Added — Browser extension (Chromium, Firefox)
- Manifest V3 extension (`extension/`, `npm run build:extension`): intercepts clicks on links to other sites (webmail!),
  shows an in-page notice, opens green links as intended (same tab, new tab, background tab) and shows its own warning
  page for suspicious, dangerous and unreachable cases with the same rules as the desktop app. Known dangerous domains
  are also blocked by session rules. Talks to the desktop app over native messaging, works alone over the server API.
- Options page (server, privacy scope, allowlist, pause, language, desktop app status). Fixed extension ids.

### Added — Server
- `POST /api/v1/check` for the apps and the extension (`docs/API.md`): limits per random installation id and per
  address (a household behind one address is not locked out), translated findings, no urlscan sandbox submissions
  (search only when the first pass is not green), no certificate-log lookup, a hard time budget per lookup so a slow
  provider can never push the answer past the apps' timeout, 10-minute in-memory cache, results never stored. `/api/health` reports `api: [1]`.
- Download page `/download` (8 languages): suggests the package for the visitor's system and lists every package with
  version, date, size and SHA-256 from the daily release query (files stay on the release storage of the code host);
  guidance for unsigned Windows/macOS builds and for loading the extension yourself. Quiet hint on the home page.
- Privacy policy (8 languages): desktop app, Android app, extension, update checks and download page.

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

### Fixed
- Brand owners' own domains are no longer reported as imitations (web mail on `outlook.office.com`, the sign-in page
  on `login.microsoftonline.com` were rated dangerous).

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
