# Reserve server (fallback)

The apps (desktop app, browser extension incl. Safari, Android app) can switch to a second check server when the
main server is unreachable. The reserve runs the same code as the main server (`src/`) as a Cloudflare Worker that
serves only the app API (`deploy/cloudflare/`). This document is the contract every client follows.

## Build variable

| Variable | Meaning |
|---|---|
| `LINKWACHE_FALLBACK_SERVER` | Address of the reserve server, e.g. `https://<name>.<account>.workers.dev`. Read at build time like `LINKWACHE_DEFAULT_SERVER`; in CI from the repository variable `vars.LINKWACHE_FALLBACK_SERVER`. Empty = no reserve (the default; nothing is baked into the source). Validated like a server address (https, no query, no fragment); ignored when equal to the main address. |

## When the reserve is used

- **Only for the built-in address.** The reserve is used only while the effective server address is the built-in
  preset (`LINKWACHE_DEFAULT_SERVER`). A user who entered an own server address never gets a foreign reserve.
- **Only for real network or server failures** ("failover-worthy"):
  - timeout, no connection (DNS, refused, reset, TLS),
  - HTTP status 500 or higher,
  - an error status whose body is not JSON (a proxy or gateway page instead of the server's answer),
  - a 2xx answer that is not a v1 answer.
- **Never** for answers that the reserve would give the same way, or that the client must respect:
  - `400` with `error: "err.install"` — the client makes a new installation id and repeats once **on the same
    server** (self-healing from 0.7.1); no switch,
  - any other `400`, `413`, `415` with a JSON body (the request itself is wrong),
  - `403` with a JSON body (`refused`, origin policy), `429` (`rate`, respect `retryAfter`),
  - `noserver` (no address) and, in the extension, `access` (the browser blocks the host; the reserve would be
    blocked too).

## Time budget

| Step | Limit |
|---|---|
| Main server, believed up | 4.5 s |
| Reserve after a failover-worthy failure | `min(6 s, 8 s − elapsed)`; skipped when less than 1.5 s remain |
| Whole check (both servers) | **≤ 8 s** |

## Remembering that the main server is down

- After a failover-worthy failure of the main server the client remembers `primaryDownUntil = now + 5 min`.
- While that is set, checks go **straight to the reserve** (timeout 6 s). If the reserve fails with a failover-worthy
  failure too, the main server is tried with what is left of the 8 s (at least 1.5 s).
- **Switching back:** while the main server is marked down, the client probes `GET <main>/api/health` in the
  background at most once every 60 s (timeout 3 s, never delays a check). A `200` JSON answer with `ok: true` clears
  the mark at once. After the 5 minutes the next check tries the main server first again anyway.
- A successful answer from the main server always clears the mark.

## What the user sees

- An answer from the reserve carries `via: "reserve"` inside the client. The result window / warning page shows a
  quiet note **"Checked via the reserve server"** (all eight languages); nothing else changes.
- When both servers fail, everything stays as before: "Could not be checked" with the reason of the **main**
  server's failure.

## Same request on both servers

The reserve gets exactly the same request as the main server: `POST /api/v1/check` with `{ url, lang, scope }`, the
installation id and the client header. Nothing else (no history, no settings).

## Server side (reserve)

- `deploy/cloudflare/wrangler.toml` deploys `src/reserve.js`: `POST /api/v1/check`, its CORS preflight, and
  `GET /api/health` (`role: "reserve"`). Everything else answers 404; `/` is a short plain page for people who open
  the address by hand. No website, no Telegram, no result pages, no KV, nothing stored.
- Limits: per installation and per IP and minute (Workers rate-limit bindings), a short in-memory cache per isolate,
  tighter lookup budget (`LITE_BUDGET_MS`) so the reserve answers within its 6 s even when a provider hangs.
- No sandbox scans: the app API never submits one, so the reserve needs no urlscan key and cannot use up the main
  server's daily urlscan budget. Optional secret: `SAFE_BROWSING_KEY` (and `URLHAUS_KEY`).
- Free plan: 100,000 requests a day; one check is one request plus about eight sub-requests (limit 50).
- Deploy with `deploy/cloudflare/deploy.sh` and an API token (template "Edit Cloudflare Workers"); no interactive
  login. On a brand-new account the freshly registered workers.dev subdomain and the new script are not visible to
  every API call at once: the script retries the deploy and then switches the workers.dev route on explicitly.
- Monitoring the reserve: Cloudflare refuses requests whose user agent is the bare default of some HTTP libraries
  (for example `Python-urllib/3.x`, answered with 403). Monitors must send their own user agent; the apps already do
  (`Linkwache-Desktop/<version>`, `Linkwache-Android/<version>`, the browser's own).
