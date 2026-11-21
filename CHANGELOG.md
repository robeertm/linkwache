# Changelog

All notable changes to Linkwache. Dates are ISO (YYYY-MM-DD).

## 0.8.5 — 2026-11-21

### Download page
- The server re-reads the release every five minutes while the latest release has no APK yet (instead of waiting for
  the regular three-hour check). The APK is attached some minutes after the release appears; before, the page could
  say "being prepared" for hours after it was there. After the APK is attached the page lists it within five minutes.

## 0.8.4 — 2026-11-21

### Android
- **Every release now carries the signed Android APK**, also when nothing changed in `android/`. Releases 0.8.2 and
  0.8.3 had none because of the old "no Android change, no APK" rule; their APKs (same version as the release, same
  signing certificate) are attached now.
- `scripts/apk_nachweis.py`: `verify` checks the published release (APK present with the release version in its
  name, listed in `SHA256SUMS.txt` with the right digest, signature valid, published certificate, `versionName` and
  `versionCode` match); `heal` signs and attaches a missing APK from the tag's green Android run and never
  overwrites an existing file. A timer on the build host runs `heal recent` every ten minutes.
- The gate before a release (`scripts/vor_auslieferung.py`) runs `verify latest`: a release without a valid APK
  blocks the next release.

### Download page
- New Android box with an install guide in all eight languages and, on a computer, a QR code that opens the page on
  the phone (inline SVG, no external resource, no inline style; only with a public https address).
- The line shown while a release has no APK yet no longer says "coming soon" but "being prepared" (the APK follows
  within minutes).
- README: QR code to the latest release, note that every release carries the APK.

### Dependencies
- `qrcode-generator` 2.0.4 (MIT, no dependencies) for the QR code.

## 0.8.3 — 2026-11-21

### Tests
- New language checks in the gate: `test/android_i18n.test.js` (Android app texts: same keys, non-empty, same
  placeholders in all eight languages, every `R.string.lw_*` used by the Kotlin code exists, generated resources up to
  date) and `test/i18n_parity.test.js` (merged server/extension/desktop table: same keys and placeholders in every
  language). Together with the existing extension and desktop checks, all surfaces are covered. No gaps found.

## 0.8.2 — 2026-11-21

### Security
- Mail intake: `postal-mime` 3.0.0 -> 4.2.1 (fixes a high-severity quadratic CPU use when decoding a header with many
  encoded words, GHSA-f2hq-32vh-53cc). The parser API is unchanged; all tests pass.
- New CI workflow `security.yml`: `npm audit` (high/critical fail), `cargo audit` on the desktop lockfile and a
  secret scan of the whole history; runs on dependency changes, weekly and on demand.

## 0.8.1 — 2026-11-18

### Changed — the reserve server is live
- The reserve server runs. This is the first release whose desktop app, browser extensions and Android app are
  built with `LINKWACHE_FALLBACK_SERVER` set, so they switch to the reserve when the main server is unreachable.
  Verified against the live reserve: same verdicts as the main server, and a real outage test with the extension
  (main server unreachable → reserve, note shown, main server probed and used again once it answers).

### Fixed
- `deploy/cloudflare/deploy.sh` works on a brand-new Cloudflare account: it retries the deploy while the freshly
  registered workers.dev subdomain and the new script are not yet visible to every API call, and switches the
  workers.dev route on explicitly.
- `deploy.sh --set-repo-variable` uses the REST API, so it also works with older `gh` releases that lack
  `gh variable`.

### Docs
- `docs/FALLBACK.md`: deploying with a token, and monitors must send their own user agent (Cloudflare refuses some
  library defaults with 403). `SETUP.md`: the deploy script replaces the manual wrangler steps.

## 0.8.0 — 2026-11-18

### Added — reserve server when the main server is unreachable
- The desktop app, the browser extension (Chromium, Firefox, Safari) and the Android app know a second check
  server. When the main server does not answer (timeout, no connection, server error, a gateway page instead of an
  answer), the same check goes straight to the reserve server; the whole check stays within 8 seconds.
- The apps remember for five minutes that the main server is down and go to the reserve directly, probe the main
  server in the background at most once a minute and switch back as soon as it answers.
- An answer from the reserve shows a quiet note "Checked via the reserve server" (all eight languages).
- No switch for answers the reserve would give the same way: a refused installation id (the app makes a new one
  and repeats once on the same server), other request errors, a refused origin, too many checks.
- Only for the built-in server address: a server address entered by the user never gets a foreign reserve.
- Build variable `LINKWACHE_FALLBACK_SERVER` (repository variable, empty = no reserve, nothing in the source).
  Contract: `docs/FALLBACK.md`.
- Reserve server: the same check code as a Cloudflare Worker that serves only the app API (`src/reserve.js`,
  `deploy/cloudflare/wrangler.toml`): no website, nothing stored, no sandbox scans (so it cannot use up the main
  server's urlscan budget), per-minute limits per installation and per IP, a tighter lookup budget. Runs on the free
  plan.

### Added — watchdog probe
- `POST /api/v1/check` with `"probe": true` runs the whole request path with heuristics only: no outside lookup, not
  cached, not counted as use. The operator's watchdog uses it every minute.

### Changed
- DNS-over-HTTPS is asked by name when the code runs on Cloudflare Workers (direct IP fetches are refused there).
- The client API's lookup budget can be tightened with `LITE_BUDGET_MS` (used by the reserve).

### Privacy
- Privacy page, imprint and download page in all eight languages: in normal operation nothing goes to the reserve;
  only when the main server fails, the app sends the same reduced request (scheme, host, path, language, scope,
  random installation id, app version) to the reserve server operated by Cloudflare, Inc. as processor.

## 0.7.1 — 2026-11-18

### Fixed — "could not be checked" on every click in Safari
- The extension no longer reports every failed check as "no connection or no answer from the server". It tells the
  reasons apart (no server address, no site access for the check server, no connection, timeout, installation id
  refused, request refused, too many checks, server error) and the warning page names the reason and the check
  server, in all eight languages.
- The server answers the CORS preflight of `POST /api/v1/check` for extension origins and adds
  `access-control-allow-origin` to every answer to an extension page. Safari applies CORS to an extension's
  background page whenever the server's host is not granted; until now it blocked the request before it was sent.
- Self-healing: when the server refuses the installation id, the extension makes a new one and repeats the check
  once; a passing network failure is repeated once. An empty server field checks against the built-in address.
- Warning page: **Check again**; when the browser blocks the server, **Allow access** (asks the browser for the
  check server's site access) with the steps for Safari and Chromium, and **Open settings**.
- Settings page: **Test connection** runs one real check and answers in plain words.
- `safari/scripts/build-local.sh` unregisters and deletes the build copy after installing, so Safari no longer lists
  the extension twice.

### Privacy
- Tokens and signatures in a link's query (for example `jwt`, `token`, `sig`, `X-Amz-Signature`, long opaque values)
  are removed before the website check asks outside services (Safe Browsing, URLhaus, PhishTank, urlscan). The app
  API never received the query in the first place.
- The warning page shows such values shortened (`jwt=eyJh…`) instead of in full.

### Notes
- Desktop app and Android app already named these reasons (no server, timeout, no connection, server, too many
  checks) and keep a valid installation id locally; unchanged in this release.

## 0.7.0 — 2026-11-16

### Added — usage figures for the operator (self-hosted build)
- Aggregated usage metrics in `data/metrics.json`: per hour (kept 30 days) and per day (kept 2 years) the requests by
  group (health check, operator, Telegram webhook, API, bots, static files, unknown paths, pages), checks by channel
  (website, desktop app, browser extension, Android, Telegram, mail, other apps) with the part answered from the app
  API cache, verdicts green/amber/red, rate-limit answers, server errors, response times (p50/p95 of checks and of
  everything except health checks), the busiest minute (all and real use only), CPU time and memory of the server
  process, bytes in and out, and an approximate number of different senders per day.
- Every check path now counts: the previous daily counter only saw website checks; app API, Telegram and mail checks
  are counted per channel. Health checks, bots and static files are reported apart from real use.
- `GET /api/stats` (contract `dienst-stats/1`, `docs/STATS.md`): read-only token `STATS_TOKEN` (or `ADMIN_TOKEN`),
  through the reverse proxy only from a private or VPN address unless `STATS_PUBLIC=on`, disabled without a token.
- Operator page `/admin`: after signing in it also shows the real requests of the last 48 hours, a table of the last
  14 days (real requests, background, checks, senders, p95, busiest minute, rejected, CPU) and the checks by channel,
  in all eight languages.

### Privacy
- Nothing personal is stored: no addresses, links, query strings, user agents or chat ids. The distinct-sender count
  uses a keyed hash with a random key per day that exists only in memory; only the number is written. The privacy
  page says so in all eight languages.

## 0.6.0 — 2026-11-16

### Added — Safari
- Browser extension for Safari on the Mac, built from the same source as the Chromium and Firefox extension
  (`node extension/scripts/build.mjs safari`): same rules, same warning page, same eight languages.
- "Linkwache for Safari": a small container app (`safari/`, Xcode project, macOS 12+, Safari 16.4+) that carries the
  extension, shows whether Safari reports it as switched on, opens Safari's extension settings and explains the
  steps in all eight languages.
- Free, build-it-yourself variant without a paid developer account: `safari/scripts/build-local.sh` builds the
  app with the free "Personal Team" of an Apple ID (or ad hoc with `--adhoc`), verifies the signature, replaces the
  installed copy with a backup until the copy succeeded and opens it. No team id or Apple ID is stored in the
  repository.
- Update notice: the container app asks the public release list once a day (switchable) and announces a newer
  version with a link to the guide; rebuilding is one script run. The free build cannot replace itself.
- Download page: Safari section "build it yourself" with the steps and a link to the guide, all eight languages.
- `Safari` workflow on a macOS runner (on demand and for changes under `safari/` or `extension/` on main):
  extension tests, Swift tests of the update check, unsigned and ad-hoc builds, bundle, version, sandbox and
  signature checks, registration of the extension with the system, window screenshots of the container app, the
  ad-hoc signed app as a zip artifact.

### Changed — extension
- The extension decides per browser what it can use: Safari never asks for native messaging (Safari only reaches
  the extension's own app, not the desktop app) and does not use `declarativeNetRequest`; known-red domains are
  still caught by the navigation fallback. New tabs are retried without opener fields where a browser rejects them;
  request timeouts fall back to an `AbortController`. The settings page explains in Safari why the desktop app
  cannot be connected.
- WebKit check of the Safari build's pages (`extension/test/e2e/webkit.py`).

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

### Fixed — apps
- Desktop app, browser extension and Android app never use cached answers of older server rules: a false alarm
  fixed on the server no longer lives on for up to 24 hours (installations from 0.5.2 and older drop their cache
  entries on the update; a newer rules version from the server drops older entries at once).
- The apps follow the server's level when the server reported every local finding itself (so an `http` hint the
  server softened no longer turns the result amber locally).
- Desktop: the warning for a dangerous link comes to the front even though Linkwache is not the active app. On
  macOS the app is activated and the window joins every Space including full-screen ones (before, the window could
  stay invisible behind or beside a full-screen browser); on Windows and Linux it stays on top and asks for
  attention when the system refuses the focus.

### Added
- Desktop: the setup assistant and the settings (Browser tab) explain that clicks inside the browser need the
  browser extension and open the installation guide on the download page, in all eight languages. `/download#ext`
  opens that guide directly.

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
