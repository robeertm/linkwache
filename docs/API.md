# Linkwache client API (v1)

Used by the desktop app, the browser extension and the Android app. Design background:
[DESKTOP.md](DESKTOP.md). Stable within `api: 1`; additions are backwards compatible, breaking
changes get a new path (`/api/v2/…`).

`POST /api/v1/check`

Request headers:
- `content-type: application/json` (else 415)
- `x-linkwache-install: <32 lowercase hex>` (else 400 `err.install`)
- `x-linkwache-client: desktop/<version>` or `extension/<version>` (informational)
- Browser pages from other web origins are refused (403); requests without `Origin` (desktop)
  and from `chrome-extension://`, `moz-extension://`, `safari-web-extension://` are allowed.

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
  "server": "0.5.0"
}
```

Errors: `400 {"error":"err.nolink"|"err.install"}`, `403 {"error":"forbidden"}`,
`413`, `415`, `429 {"error":"err.rate","retryAfter":<s>}`, `500 {"error":"internal"}`.

Limits (env-configurable): per installation `V1_PER_MINUTE`=60, `V1_PER_DAY`=3000; per client
IP (hashed, /64 for IPv6) `V1_IP_PER_MINUTE`=120, `V1_IP_PER_DAY`=10000 so a whole household
behind one address is fine but rotating ids does not open the door. The website keeps its own
10/min and 150/day.

Third-party budget: the v1 path never submits a urlscan sandbox scan; the urlscan *search* runs
only when the first pass is not green. crt.sh gets a short timeout. Results are cached in memory
per normalised URL for 10 minutes to absorb repeated clicks.

`GET /api/health` additionally reports `"api": [1]` so clients can detect support.

No open proxy: the server never fetches the target page (only shortener HEAD hops, as before,
with the same blocked targets: private/loopback addresses, non-http schemes).

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
