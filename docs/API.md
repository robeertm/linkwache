# Linkwache client API (v1)

Used by the desktop app, the browser extension and the Android app. Design background:
[DESKTOP.md](DESKTOP.md). Stable within `api: 1`; additions are backwards compatible, breaking
changes get a new path (`/api/v2/…`).

`POST /api/v1/check`

Request headers:
- `content-type: application/json` (else 415)
- `x-linkwache-install: <32 lowercase hex>` (else 400 `err.install`)
- `x-linkwache-client: desktop/<version>`, `extension/<version>` or `android/<version>` (informational)
- Browser pages from other web origins are refused (403); requests without `Origin` (desktop)
  and from `chrome-extension://`, `moz-extension://`, `safari-web-extension://` are allowed.
- CORS (0.7.1): `OPTIONS /api/v1/check` from an extension origin answers 204 with
  `access-control-allow-origin: <that origin>`, `access-control-allow-methods: POST` and
  `access-control-allow-headers: content-type, x-linkwache-install, x-linkwache-client`; every answer to an
  extension origin (also 400/403/429) carries `access-control-allow-origin`, so the client can read the error.
  Other origins get 403 on the preflight and no CORS headers. Chromium and Firefox skip CORS for hosts the
  extension holds a permission for; Safari applies it to the background page whenever the server's host is not
  granted, and without these headers it blocks the request before it is sent.

Client behaviour on errors (extension 0.7.1, `extension/src/client.js`): `400 err.install` → the client makes a
new installation id and repeats the request once; a network failure is repeated once, unless the browser reports
that the extension has no access to the server's host (then reason `access`); a timeout is never repeated. The
warning page names the reason (`noserver`, `access`, `network`, `timeout`, `install`, `refused`, `rate`, `server`)
and the server host instead of a general "no connection".

Request body:
```json
{ "url": "https://example.com/path", "lang": "en", "scope": "url" }
```
`scope`: `"url"` (default) or `"domain"`; with `"domain"` the server reduces the input to
`https://host/` itself as well. The server always drops query string and fragment from what it
sends to third-party lookups unless the client sent them (clients don't).

Response 200:
```json
{
  "api": 1,
  "stufe": "gruen | gelb | rot",
  "score": 0,
  "kurzKey": "v.gruen", "ratKey": "v.gruen.rat",
  "kurz": "<translated short verdict>", "rat": "<translated advice>",
  "url": "<checked url after shortener unwrapping>",
  "host": { "host": "…", "domain": "…", "unicodeHost": "…" },
  "chain": ["<hosts of an unwrapped shortener chain>"],
  "findings": [ { "key": "tld", "stufe": "gelb", "p": {"tld": "top"},
                  "titel": "<translated>", "text": "<translated>" } ],
  "cacheTtl": 21600,
  "checked": "2026-11-16T12:00:00.000Z",
  "server": "0.5.0",
  "rules": 2
}
```

`rules` (since 0.5.3, also in `/api/health`) is the version of the rules that decide a result. Clients store it
with every cached answer and never use answers of older rules; when an answer carries a higher version than
they know, they drop all older cached answers. Answers without the field count as version 1.

Fraud lists (0.5.3): a list makes a link red only when it names exactly this URL (scheme ignored, host lower case,
path and query as reported). Entries that only name other pages under the same name give `list-host` (amber, on the
well-known site itself info). A listed start page of a well-known site gives `list-known` (info). `http` to the
well-known site itself is info. Clients defer to the server's level when the server reported every finding of the
local heuristics itself.

Errors: `400 {"error":"err.nolink"|"err.install"}`, `403 {"error":"forbidden"}`,
`413`, `415`, `429 {"error":"err.rate","retryAfter":<s>}`, `500 {"error":"internal"}`.

Limits (env-configurable): per installation `V1_PER_MINUTE`=60, `V1_PER_DAY`=3000; per client
IP (hashed, /64 for IPv6) `V1_IP_PER_MINUTE`=120, `V1_IP_PER_DAY`=10000 so a whole household
behind one address is fine but rotating ids does not open the door. The website keeps its own
10/min and 150/day.

Third-party budget and time: the v1 path never submits a urlscan sandbox scan; the urlscan *search*
runs only when the first pass is not green; crt.sh is skipped (it only adds an info finding without
weight). Every lookup has a hard deadline (shortener unwrapping 2 s, first pass 2.5 s, urlscan search
1.2 s) — a provider that is late counts as unavailable — so the answer always arrives well before
the clients' 6 s timeout. Results are cached in memory per normalised URL for 10 minutes to absorb
repeated clicks.

`GET /api/health` additionally reports `"api": [1]` so clients can detect support.

No open proxy: the server never fetches the target page (only shortener HEAD hops, as before,
with the same blocked targets: private/loopback addresses, non-http schemes).

## Reserve server

When the main server is unreachable, the apps send the same request to a reserve server (a Cloudflare Worker with
only this API and `GET /api/health`, `role: "reserve"`), see [FALLBACK.md](FALLBACK.md). Nothing is stored there.

## Watchdog probe

`POST /api/v1/check` with `"probe": true` in the body (and the usual installation id header) is for monitors that
check whether the check path works. The server answers from its own heuristics only: **no outside lookup**, the
probe is **not counted** in the statistics and **not cached**. The same installation id requirement and rate limits
apply. The answer carries `"probe": true`.

## Native messaging (extension ↔ desktop app)

Host name `app.linkwache.desktop`; the desktop app installs the host manifest for Chrome,
Chromium, Edge, Brave and Firefox and starts itself with `--native-messaging` as the host.
Allowed extension ids: Chromium `ldehleohedacddboipopkjkphjnphine` (fixed by the `key` in
`extension/manifest.json`), Firefox `{ef1e5d25-3e24-4517-a534-dad3a936dcb3}`.
Messages are JSON (length-prefixed as the browsers require):

| From extension | Answer from app |
|----------------|-----------------|
| `{"type":"hello","version":"0.5.0"}` | `{"type":"hello","app":"0.5.0","server":"https://…","scope":"url","paused":false}` |
| `{"type":"check","id":"7","url":"https://…","lang":"de"}` | `{"type":"result","id":"7","source":"allowlist|cache|server|local", …same fields as the v1 response…}` or `{"type":"result","id":"7","offline":true,"local":{"stufe":"…","findings":[…]}}` |
| `{"type":"allow","domain":"example.com"}` | `{"type":"ok"}` (user allowlisted the domain from a warning page) |
| `{"type":"log","event":"open-anyway","stufe":"gelb|rot","domain":"…"}` | `{"type":"ok"}` (local history only) |

The app answers `{"type":"error","id":…,"error":"…"}` for anything it does not understand.
