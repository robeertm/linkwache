# Usage figures (self-hosted build)

The Node server (`server/index.js`) keeps aggregated usage figures so the operator can see how much the service is
used and whether the machine it runs on is still enough. The Cloudflare build does not keep any.

## What is counted

Only numbers. Never stored: addresses, links, query strings, user agents, chat ids.

| Field | Meaning |
|---|---|
| `req` | HTTP requests by group: `health`, `admin`, `telegram`, `api`, `bot`, `static`, `notfound`, `page` |
| `work` | checks by channel: `web`, `desktop`, `extension`, `android`, `v1_other`, `telegram`, `mail` |
| `cache` | part of `work` answered from the in-memory cache of the app API |
| `res` | verdicts `gruen` / `gelb` / `rot` |
| `rl`, `rl_by` | HTTP 429 answers, total and by group |
| `e5` | HTTP 5xx answers |
| `lat_work`, `lat_all` | response time histograms (ms) with `p50`/`p95`: checks, and every request except health checks |
| `peak_min`, `peak_min_real` | busiest wall-clock minute: all requests, and only `page` + `api` + `telegram` |
| `cpu_ms`, `rss_max_mb` | CPU time and peak memory of the server process |
| `bytes_in`, `bytes_out` | request and response bytes |
| `users` (days only) | approximate number of different senders (`page` and `api`) |

Groups, first match wins: `/api/health` → health; `/admin`, `/api/admin/*`, `/api/stats` → admin; `/telegram` →
telegram; other `/api/*` → api; empty or crawler/monitor user agent → bot; file extensions and `/.well-known/` →
static; 404 → notfound; anything else → page.

Senders: a keyed hash (HMAC-SHA256 with a random key per process and UTC day, never written) of the address the rate
limiter already uses goes into an in-memory set; only its size is stored. After a restart the day continues from the
stored number, so the value is approximate.

Buckets are UTC hours (`2026-11-16T21`) kept 30 days and UTC days kept 2 years, in `data/metrics.json`
(written every minute and on shutdown).

## API

`GET /api/stats?hours=168&days=730` with `Authorization: Bearer <STATS_TOKEN or ADMIN_TOKEN>`.

- No token configured → 404. Wrong token → 401.
- Requests that came through the reverse proxy (`X-Real-IP` set) are only answered for private, loopback or
  shared-address-space (RFC 6598, used by VPNs) senders (403 otherwise), unless `STATS_PUBLIC=on`.
- 30 requests per minute per caller.

Answer (contract `dienst-stats/1`):

```json
{
  "schema": "dienst-stats/1", "service": "linkwache", "version": "0.7.0", "work_unit": "check",
  "generated": "2026-11-16T22:10:00Z", "bucket_tz": "UTC",
  "process": { "started": "…", "uptime_s": 3600, "cpu_ms": 51234, "rss_mb": 48 },
  "limits": { "per_minute": 10, "per_day": 150, "v1_per_minute": 60, "v1_per_day": 3000,
              "scan_budget_per_day": 200, "scans_today": 3 },
  "hours": [ { "t": "2026-11-16T21", "req": {}, "work": {}, "cache": {}, "res": {}, "rl": 0, "rl_by": {}, "e5": 0,
               "lat_work": { "n": 0, "p50": null, "p95": null, "h": [] }, "lat_all": {},
               "peak_min": 0, "peak_min_real": 0, "cpu_ms": 0, "rss_max_mb": 0, "bytes_in": 0, "bytes_out": 0 } ],
  "days": [ { "d": "2026-11-16", "users": 12, "…": "same fields as hours" } ],
  "legacy_days": [ { "d": "2026-09-19", "requests": 8123 } ]
}
```

Histogram edges (ms): 10, 25, 50, 100, 250, 500, 1000, 1500, 2500, 5000, 10000, ∞. A percentile is the upper edge of
the first bucket reaching it (∞ reports 20000). `legacy_days` are the older daily request counters (`data/stats.json`)
that had no groups.
