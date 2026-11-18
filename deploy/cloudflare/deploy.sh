#!/usr/bin/env bash
# Deploy the reserve server (docs/FALLBACK.md) with an API token, without any interactive login.
#
#   deploy/cloudflare/deploy.sh [--subdomain <name>] [--set-repo-variable owner/repo]
#
# Environment:
#   CF_TOKEN_FILE    file holding a Cloudflare API token (template "Edit Cloudflare Workers"), default
#                    ~/.config/cloudflare/token (keep it 0600). The token goes to wrangler through the environment,
#                    never on a command line.
#   SB_KEY_CMD       optional command that prints the Safe Browsing key on stdout; it is piped into
#                    `wrangler secret put SAFE_BROWSING_KEY` (never echoed).
#
# Steps: check the token → find the account → make sure the account has a workers.dev subdomain (registers
# --subdomain if none exists) → wrangler deploy → optional secret → health check of the reserve (role "reserve") and
# one real check → optional: set the repository variable LINKWACHE_FALLBACK_SERVER (gh) so the next app builds know it.
set -euo pipefail
cd "$(dirname "$0")/../.."
TOKEN_FILE="${CF_TOKEN_FILE:-$HOME/.config/cloudflare/token}"
SUB="" REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --subdomain) SUB="$2"; shift 2;;
    --set-repo-variable) REPO="$2"; shift 2;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
done
[ -r "$TOKEN_FILE" ] || { echo "no token file $TOKEN_FILE" >&2; exit 2; }
[ "$(stat -c %a "$TOKEN_FILE" 2>/dev/null || stat -f %Lp "$TOKEN_FILE")" = "600" ] || { echo "token file must be 0600" >&2; exit 2; }
CLOUDFLARE_API_TOKEN="$(tr -d ' \r\n' < "$TOKEN_FILE")"
export CLOUDFLARE_API_TOKEN WRANGLER_SEND_METRICS=false
api() { curl -sS -K <(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN") -H "content-type: application/json" "$@"; }

echo "1/6 token"
api https://api.cloudflare.com/client/v4/user/tokens/verify | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('success') and d['result']['status']=='active', d.get('errors'); print('   active')"
ACC=$(api "https://api.cloudflare.com/client/v4/accounts?per_page=5" | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; assert len(r)>=1, 'no account'; print(r[0]['id'])")
export CLOUDFLARE_ACCOUNT_ID="$ACC"
echo "2/6 account found"

echo "3/6 workers.dev subdomain"
CUR=$(api "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/subdomain" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('result') or {}).get('subdomain') or '')")
if [ -z "$CUR" ]; then
  [ -n "$SUB" ] || { echo "   the account has no workers.dev subdomain yet: run again with --subdomain <name>" >&2; exit 3; }
  api -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/subdomain" --data "{\"subdomain\":\"$SUB\"}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('success'), d.get('errors'); print('   registered')"
  CUR="$SUB"
fi
URL="https://linkwache-reserve.$CUR.workers.dev"
echo "   reserve address: $URL"

echo "4/6 deploy"
npx --yes wrangler deploy -c deploy/cloudflare/wrangler.toml 2>&1 | grep -v -i token | tail -5
if [ -n "${SB_KEY_CMD:-}" ]; then
  bash -c "$SB_KEY_CMD" | tr -d '\r\n' | npx --yes wrangler secret put SAFE_BROWSING_KEY -c deploy/cloudflare/wrangler.toml 2>&1 | grep -v -i key | tail -1
fi

echo "5/6 check (a fresh workers.dev name can take a minute)"
for i in $(seq 1 20); do
  if curl -s -m 8 "$URL/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['ok'] and d['role']=='reserve'; print('   health ok, version', d['version'], 'safe browsing', d['sb'])" 2>/dev/null; then break; fi
  [ "$i" = 20 ] && { echo "   reserve does not answer" >&2; exit 4; }
  sleep 6
done
printf '{"url":"https://example.com/","lang":"en"}' | curl -s -m 10 -X POST -H "content-type: application/json" \
  -H "x-linkwache-install: 0123456789abcdef0123456789abcdef" -H "x-linkwache-client: deploy/1" --data-binary @- "$URL/api/v1/check" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['api']==1; print('   check ok:', d['stufe'])"

echo "6/6 repository variable"
if [ -n "$REPO" ]; then
  gh variable set LINKWACHE_FALLBACK_SERVER -R "$REPO" --body "$URL" && echo "   LINKWACHE_FALLBACK_SERVER set — the next release builds the apps with the reserve"
else
  echo "   skipped (--set-repo-variable owner/repo)"
fi
