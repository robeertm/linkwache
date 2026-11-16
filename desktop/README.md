# Linkwache Desktop

Background app for Windows 10/11, macOS 12+ and Linux (x86_64, arm64): it registers as the
http/https handler, checks every clicked link (local heuristics, allowlist, cache, the
Linkwache server) and forwards links without warning signs to the user's real browser.
Design and contract: [docs/DESKTOP.md](../docs/DESKTOP.md), [docs/API.md](../docs/API.md).

## Layout

| Path | What |
|------|------|
| `core/` | `linkwache-core`: all decisions without UI — URL normalisation, scheme filter, redirector unwrapping, heuristics port (`test/vectors/*.json`), allowlist with look-alike protection, cache, privacy reduction, API client (6 s timeout), history, settings, native messaging, updater backup logic |
| `src-tauri/` | Tauri 2 app: OS integration (`src/platform/`), check flow, windows, tray, updater, CLI |
| `ui/` | plain HTML/CSS/JS (no bundler): toast, warning, setup assistant, settings |
| `ui/i18n.generated.*` | generated from `src/i18n.js` by `scripts/i18n.mjs` — never edit |
| `e2e/` | end-to-end driver (`run.mjs`), mock server, fake browsers |
| `scripts/` | string generator, release assets, signing helpers |

## Develop

```sh
cd desktop
cargo test -p linkwache-core          # fast, no Tauri
node scripts/i18n.mjs                 # after changing strings in src/i18n_desktop.js
npm ci && npx tauri build             # full build (Linux needs libwebkit2gtk-4.1-dev etc.)
```

`LINKWACHE_DEFAULT_SERVER` (build-time environment, a repository variable in CI) prefills the
server address in the setup assistant. The address is never written into the source.

The settings remember whether the address is the preset (`server_preset`). When a later release
ships another preset, installations that follow it move along; an address the user entered
stays. `LINKWACHE_PRESET_MIGRATE_FROM` (build-time, repository variable, addresses separated by
commas or spaces) lists earlier presets: installations from 0.5.0/0.5.1, which stored the
preset without that marker, move from those to the current preset.

Command line (installer hooks, administrators, tests): `linkwache --help`.

## Releases

The tag workflow (`.github/workflows/desktop.yml`) builds everything, runs the E2E tests on
all systems and attaches installers, updater artefacts, `latest.json` and `SHA256SUMS.txt`
to the **pre-release**. The release broker promotes it; only the latest release is seen by
the updater (`releases/latest/download/latest.json`).

Updater signatures use the minisign key in the repository secrets
`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is in
`src-tauri/tauri.conf.json`.

### macOS signing and notarisation (maintainer's Mac)

The Developer ID stays on the Mac, the updater key stays in CI. Once per Mac:

```sh
xcrun notarytool store-credentials linkwache-notary \
  --apple-id <apple id> --team-id <TEAMID> --password <app-specific password>
security find-identity -v -p codesigning     # shows "Developer ID Application: … (TEAMID)"
```

For every release, after the tag workflow attached the unsigned macOS files:

```sh
cd linkwache && git pull
MAC_SIGN_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" \
NOTARY_PROFILE=linkwache-notary \
desktop/scripts/macos-sign-notarize.sh v0.5.0
```

The script signs the app (hardened runtime, timestamp), notarises and staples app and DMG,
uploads `Linkwache_<v>_universal.dmg` and `Linkwache_<v>_universal.app.tar.gz` with
`--clobber`, and starts the workflow **Desktop macOS re-sign** (`desktop-mac-resign.yml`),
which signs the new tarball with the updater key and rewrites `latest.json` and
`SHA256SUMS.txt`. Until then the macOS build is unsigned (Gatekeeper: right-click → Open).

### Windows code signing (prepared)

Shipped unsigned for now. Setting the repository secret `WINDOWS_SIGN_MODE` (`pfx` with
`WINDOWS_CERT_PFX` + `WINDOWS_CERT_PASSWORD`, or `azure` with `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`,
`AZURE_SIGNING_PROFILE`) makes the build sign the binary, the NSIS installer and the MSI via
`scripts/windows-sign.ps1` before the updater signatures are computed.

Managed PCs: `docs/windows-default-associations.xml` (DISM / Group Policy).
