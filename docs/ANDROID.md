# Linkwache for Android

Every web link you tap on your phone — in a mail, a messenger, a text message, a PDF — goes
through the Linkwache before it opens. Links without warning signs open in your normal
browser right away; for everything else you see a clear warning first.

Linkwache never says a link is "safe". It looks for warning signs; it cannot prove that a
page is harmless.

- Code: [`android/`](../android) (Kotlin, Jetpack Compose, Material 3)
- Server contract: [API.md](API.md) (`POST /api/v1/check`), shared with the desktop app and
  the browser extension ([DESKTOP.md](DESKTOP.md))
- Minimum Android 8.0 (API 26), target Android 16 (API 36)

## How it works

Linkwache registers as a **browser app**. Once you choose it as the default browser, Android
hands it every tapped `http`/`https` link. Linkwache checks the link and then passes it on to
your **real browser**, which you pick once in the setup assistant (changeable in the settings).

```
tap on a link ─▶ Linkwache (default browser app)
                  1. unwrap known link wrappers (mail safety links, search/social redirects)
                  2. local heuristics (same rules as the server, pinned by shared test vectors)
                  3. allowlist / on-device cache
                  4. POST /api/v1/check  (hard 6 s timeout)
                 ─▶ forward with an explicit package name to your real browser
```

- The forward always names the browser package explicitly, so a link can never loop back
  to Linkwache. Linkwache itself can never be chosen as the forward target.
- Only `http` and `https` are handled. Other schemes are never registered and never launched.
- **Share → "Check with Linkwache"** works from any app, also for text that contains a link
  (the first web link in the text is checked). The text selection menu offers the same.

### What you see

A small check sheet appears over the app the link came from:

| Result | Sheet | What happens |
|--------|-------|--------------|
| checking | "Linkwache is checking …" with the domain | — |
| no warning signs | "No warning signs – opening" | opens after ~0.7 s in your browser |
| suspicious | warning with the findings in plain language | "Don't open" is the main button; "Open anyway" becomes active after 3 s |
| dangerous | blocked, with the findings | nothing opens; opening only via "I know what I am doing" → confirm (after 3 s) |
| could not be checked | reason (timeout, no connection, server error, rate limit) and the local assessment | you decide; nothing opens on its own. A link the local check already rates dangerous stays blocked |

Links that are on the allowlist or were checked recently (on-device cache: 6 h for
"no warning signs", 24 h for warnings) are decided without a server round trip.

### Privacy

- The server receives `scheme://host[:port]/path` — **query string and fragment stay on the
  phone**. Setting "Domain only" sends just `https://host/`.
- Server results are not stored on the server (see API.md). The installation ID is 128 random
  bits used only for the server's rate limit; it can be reset in the settings.
- History (last 200 checks, domains only) and cache stay on the phone. App data is excluded
  from cloud backup and device transfer. No telemetry, no analytics, no ads.

## What Android does not let Linkwache check

Please read this before relying on the app:

1. **In-app browsers.** Some apps open links inside their own built-in browser (a WebView),
   for example several social networks and some messengers. Those links never reach the
   default browser and therefore bypass Linkwache. Use **Share → Check with Linkwache** in
   such apps, or switch the app's setting to open links in the default/external browser.
2. **Custom Tabs.** Apps that show links in a "Custom Tab" ask the default browser for its
   tab service. Linkwache answers this request (without preloading anything), so these links
   are checked as well and then opened as a Custom Tab of your real browser. An app that
   hard-codes a specific browser package for its tabs bypasses the default browser — and
   Linkwache — entirely; that cannot be intercepted.
3. **Verified app links.** Links to domains that an installed app has verified (for example a
   shop or video site whose app is installed) are opened by that app directly. Android never
   asks the default browser for them.
4. **Links you type into the browser** or open from the browser's own bookmarks are not
   checked (that happens inside the browser). The browser extension covers desktop browsers;
   mobile browsers do not support it.
5. **QR codes** opened by the camera app go through the default browser and are checked; QR
   scanners with their own web view are not.

## Installation (APK)

Linkwache is not in an app store for now. The APK is attached to every
[GitHub release](https://github.com/robeertm/linkwache/releases/latest) and linked on the
download page of the Linkwache site (`/download`).

1. Download `Linkwache-android-X.Y.Z.apk` on the phone.
2. Optional but recommended: compare the SHA-256 shown on the download page / release with
   the file.
3. Open the file. Android asks to **allow installing apps from this source** (browser or
   file manager) — allow it for this one installation, then go back and tap *Install*.
   ("Settings → Apps → Special app access → Install unknown apps" if the prompt does not
   appear.)
4. Open Linkwache. The setup assistant walks through five steps:
   1. what Linkwache does,
   2. the server (preset; only change it if you run your own),
   3. your real browser (your previous default is preselected),
   4. **make Linkwache the default browser app** — Android shows its own confirmation
      dialog. If it does not appear: *Settings → Apps → Default apps → Browser app →
      Linkwache*. The assistant checks the result by itself when you come back,
   5. done — try it with a test link.

The signing certificate of every official APK has this SHA-256 fingerprint:

```
24:A4:B8:A1:B1:8E:BA:7E:7D:EB:80:3B:7C:19:36:48:AF:01:99:83:96:0B:E7:80:9C:B0:B2:39:18:70:95:02
```

## Updates

- The app looks for a newer version at most twice a day (the GitHub release marked
  *latest*; pre-releases are never offered) and only shows a notice in the app. This can be
  switched off in the settings; "Check now" is always available.
- One tap downloads the APK. Before anything is installed, Linkwache checks
  1. the **SHA-256** of the download against the release asset's digest (or `SHA256SUMS.txt`),
  2. the **package name**, a **higher version code**, and
  3. that the APK is signed with **exactly the certificate of the installed app**.
  Only then is it handed to Android's package installer, which asks you to confirm.
  Android enforces the same certificate again during the install.
- Settings, allowlist and history are kept across updates (Android keeps app data). Earlier
  versions stay available on the releases page.
- Installing updates needs the one-time permission "Install unknown apps" for Linkwache; the
  app explains this and opens the right settings page.

## Building

```sh
node android/scripts/gen-strings.mjs        # string resources from src/i18n.js + android/i18n/app.json
cd android
./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
LINKWACHE_DEFAULT_SERVER=https://example.org ./gradlew :app:assembleRelease   # unsigned
```

- `core/` is plain Kotlin (no Android SDK needed): heuristics, wrappers, allowlist, check
  flow, API client, cache, update logic. Its tests run the shared vectors in
  `test/vectors/` against the port, so it cannot drift from the server.
- `app/` is the Android app. `fakebrowser/` is a test helper for the emulator tests only.
- The version follows `package.json`; `versionCode = major·10000 + minor·100 + patch`.
- `LINKWACHE_DEFAULT_SERVER` sets the preset server address at build time (empty: the
  setup assistant asks for one). The app stores an address only when the user enters one
  that differs from the preset, so installations follow a new preset by themselves.
  `LINKWACHE_PRESET_MIGRATE_FROM` (build-time, earlier presets separated by commas or spaces)
  drops a stored copy of an earlier preset at start; an address of the user's own stays.

### Reserve server

`LINKWACHE_FALLBACK_SERVER` (build-time, in CI the repository variable of the same name; empty = none) sets the
address of the reserve server. While the built-in address is in use, a check that fails for a network or server
reason (timeout, no connection, status 500 or higher, a non-JSON error page, a malformed 2xx answer) is repeated on
the reserve within a total budget of 8 seconds; the main server is remembered as down for 5 minutes and probed
in the background (`/api/health`, at most once a minute). An address the user entered never gets a reserve.
An answer from the reserve shows a quiet note in the sheet. A rejected installation id (`400 err.install`) is
renewed and the check repeated once on the same server. The full contract is in [FALLBACK.md](FALLBACK.md); the
logic is `core/.../Failover.kt` (unit tests: `FailoverTest`).

### Continuous integration

`.github/workflows/android.yml` runs on every change below `android/`:

- unit tests (core + Robolectric), lint for debug and release, string check, debug and
  unsigned release build;
- an **end-to-end test on an Android 14 emulator** (`android/e2e/run.sh`) with a stand-in
  server and a stand-in browser: Linkwache holds the browser role; a link without warning
  signs reaches the browser (query string never sent to the server); local and server red
  links are blocked and open only after the deliberate second step; amber waits for
  "Open anyway"; allowlisted links make no server call; share and Custom Tab entries work;
  with the server gone the sheet says "Could not be checked" and nothing opens; the updater
  refuses a wrong checksum and a foreign signature and hands a correct update to the system
  installer. Test links use reserved test domains only;
- screenshots of every state (setup, checking, green, amber, red, offline, settings, update
  notice) in light and dark, phone and tablet, English and German.

### Release signing

CI never sees the signing key. For a release, the unsigned APK from the tag's CI run is
signed on the maintainer's build host with `android/scripts/sign-release.sh`, which checks
the CI checksum and zip alignment, signs with APK signature scheme v2 + v3, verifies the
result and refuses any certificate other than the one above. `android/scripts/publish-apk.sh
vX.Y.Z` attaches it to the existing GitHub release — only if the Android workflow of the tag's
commit (tests, lint, emulator test) succeeded — and compares the digest GitHub reports with the
local SHA-256. It never creates tags or releases. The download page and the in-app updater
pick the APK up from the release.

**Every release carries the APK**, also when nothing changed in `android/`: the app version
always follows `package.json` (`versionName` = version, `versionCode` = major·10000 + minor·100
+ patch), and the Android workflow runs for every tag. `scripts/apk_nachweis.py` enforces it:

- `python3 scripts/apk_nachweis.py verify [vX.Y.Z|latest]` checks the PUBLISHED release: the file
  `Linkwache-android-X.Y.Z.apk` exists, `SHA256SUMS.txt` lists it with the right digest,
  `apksigner` verifies the signature, the certificate is the one above and `versionName` /
  `versionCode` match the release.
- `scripts/vor_auslieferung.py` (the gate before a release) runs `verify latest` — a release
  without a valid APK blocks the next one.
- `python3 scripts/apk_nachweis.py heal [vX.Y.Z|latest|recent]` repairs a release without an
  APK: it signs the APK of the tag's green Android run, attaches it (never overwriting an
  existing file), rewrites `SHA256SUMS.txt` and verifies again. A timer on the build host runs
  `heal recent` every ten minutes, so the APK shows up shortly after the release.

The download page (`/download`) shows the APK for every Android visitor, an install guide in
all eight languages and — on a computer — a QR code that opens the page on the phone.

Emulator CI also installs the minified release build (signed with a throwaway test key,
for this test only) and checks that the sheet renders and a link gets a verdict.

## Languages

German, English, Turkish, Polish, Russian, Spanish, French, Italian — following the phone's
language (Android 13+: per app in the system settings). Verdict and finding texts come from
the server's translations (`src/i18n.js`); app texts live in `android/i18n/app.json`. A unit
test fails when a language misses a text or a placeholder.
