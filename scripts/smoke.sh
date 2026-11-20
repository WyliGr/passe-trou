#!/usr/bin/env bash
# passe•trou end-to-end smoke: boots the API on a free test port against the
# dev DB (DATABASE_URL), seeds presets, wires a mock upstream account pool,
# streams one proxied request, and checks /admin/overview reflects the row
# and its cost. Exits non-zero on any failure; cleans up its processes and
# the admin entities it created. No third-party deps (node, npx, curl only).
#
# Credentials: read from the environment first, then apps/api/.env
# (untracked). Run: bash scripts/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/apps/api"
TMP="$(mktemp -d)"
RUN="smoke-$RANDOM-$(( $(date +%s) % 100000 ))"
APP_PID=""; MOCK_PID=""
PROVIDER_ID=""; ACCOUNT_ID=""; MODEL_ID=""; MAPPING_ID=""; MEMBER_ID=""; KEY_ID=""
PRICES_ORIG=""

die() {
  echo "SMOKE FAIL: $*" >&2
  echo "--- app log tail ---" >&2; tail -n 15 "$TMP/app.log" >&2 2>/dev/null || true
  echo "--- mock log tail ---" >&2; tail -n 15 "$TMP/mock.log" >&2 2>/dev/null || true
  exit 1
}
ok() { echo "ok $1 — $2"; }

# --- credentials: env wins, then untracked apps/api/.env ---------------------
envfile_val() { grep -E "^$1=" "$API/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }
DATABASE_URL="${DATABASE_URL:-$(envfile_val DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || die "DATABASE_URL required (env or apps/api/.env)"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(envfile_val ADMIN_TOKEN)}"
if [ -z "$ADMIN_TOKEN" ]; then
  ADMIN_TOKEN="$(node -e 'console.log("smoke-admin-"+crypto.randomBytes(24).toString("hex"))')"
fi
ENCRYPTION_MASTER_KEY="${ENCRYPTION_MASTER_KEY:-$(envfile_val ENCRYPTION_MASTER_KEY)}"
if [ -z "$ENCRYPTION_MASTER_KEY" ]; then
  ENCRYPTION_MASTER_KEY="$(node -e 'console.log(crypto.randomBytes(32).toString("hex"))')"
fi
export DATABASE_URL ADMIN_TOKEN ENCRYPTION_MASTER_KEY

command -v node >/dev/null || die "node not found"
command -v npx >/dev/null || die "npx not found"
command -v curl >/dev/null || die "curl not found"

# Free test port (ephemeral range: never 8477/5434).
PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
[ "$PORT" != "8477" ] && [ "$PORT" != "5434" ] || die "port clash: $PORT"
BASE="http://127.0.0.1:$PORT"

cleanup() {
  if [ -n "$BASE" ] && [ -n "${PROVIDER_ID:-}" ]; then
    # Best-effort: restore the price table and drop the entities we created.
    [ -n "$PRICES_ORIG" ] && curl -s --max-time 5 -o /dev/null -X PUT "$BASE/admin/prices" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
      -d "{\"prices\":$PRICES_ORIG}" || true
    for pair in "keys:$KEY_ID" "members:$MEMBER_ID" "mappings:$MAPPING_ID" "models:$MODEL_ID" "accounts:$ACCOUNT_ID" "providers:$PROVIDER_ID"; do
      id="${pair#*:}"; res="${pair%%:*}"
      [ -n "$id" ] && curl -s --max-time 5 -o /dev/null -X DELETE "$BASE/admin/$res/$id" \
        -H "Authorization: Bearer $ADMIN_TOKEN" || true
    done
  fi
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  sleep 0.3
  [ -n "$APP_PID" ] && kill -9 "$APP_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && kill -9 "$MOCK_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# Extract a dotted field from a JSON document on stdin.
json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let v=JSON.parse(s);
    for(const k of process.argv[1].split(".")) v=v?.[k];
    if(v===undefined||v===null) process.exit(2);
    console.log(typeof v==="object"?JSON.stringify(v):String(v));
  })' "$1"
}

# req <expected-status> <METHOD> <path> [json-body] [bearer-token]
BODY=""
req() {
  local want="$1" method="$2" path="$3" data="${4:-}" token="${5:-}" got
  local args=(-sS --max-time 10 -o "$TMP/body.json" -w "%{http_code}" -X "$method" "$BASE$path")
  [ -n "$data" ] && args+=(-H 'content-type: application/json' -d "$data")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  got="$(curl "${args[@]}")" || die "curl $method $path failed to run"
  [ "$got" = "$want" ] || die "$method $path → $got (want $want): $(cat "$TMP/body.json" 2>/dev/null)"
  BODY="$(cat "$TMP/body.json")"
}

# --- 1. mock upstream fixture (recorded CommandCode streams, never real) ----
# node --import tsx directly (no npx shim) so $! is the real process and the
# cleanup trap kills the actual server, not an orphaned wrapper.
(
  cd "$API"
  exec node --import tsx -e 'import("./tests/fixtures/mockUpstream.ts").then(async (m) => {
    const u = await m.startMockUpstream();
    console.log("MOCK_URL=" + u.url);
    setInterval(() => {}, 1000);
  })'
) >"$TMP/mock.log" 2>&1 &
MOCK_PID=$!
MOCK_URL=""
for _ in $(seq 1 100); do
  MOCK_URL="$(grep '^MOCK_URL=' "$TMP/mock.log" 2>/dev/null | cut -d= -f2- || true)"
  [ -n "$MOCK_URL" ] && break
  kill -0 "$MOCK_PID" 2>/dev/null || die "mock upstream exited early"
  sleep 0.1
done
[ -n "$MOCK_URL" ] || die "mock upstream did not announce its URL"
ok 1 "mock upstream on $MOCK_URL"

# --- 2. boot the app under test ---------------------------------------------
(
  cd "$API"
  exec env PORT="$PORT" node --import tsx src/index.ts
) >"$TMP/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 150); do
  if curl -sS --max-time 2 -o /dev/null "$BASE/healthz" 2>/dev/null; then break; fi
  kill -0 "$APP_PID" 2>/dev/null || die "app exited early"
  sleep 0.2
done
req 200 GET /healthz
echo "$BODY" | json_get ok >/dev/null || die "healthz body unexpected: $BODY"
ok 2 "healthz on :$PORT"

# --- 3. admin gate closed without the token ---------------------------------
req 401 GET /admin/providers
echo "$BODY" | json_get error.code | grep -q '^unauthorized$' || die "401 body unexpected: $BODY"
ok 3 "admin without token → 401 unauthorized"

# --- 4. seed presets (idempotent) -------------------------------------------
(cd "$API" && npx prisma db seed) >"$TMP/seed.log" 2>&1 || die "prisma db seed failed: $(tail -n 5 "$TMP/seed.log")"
req 200 GET /admin/providers "" "$ADMIN_TOKEN"
echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const names=JSON.parse(s).map(p=>p.displayName);
  if(!names.includes("CommandCode")||!names.includes("Mistral")) process.exit(1);
})' || die "seeded providers missing: $BODY"
req 200 GET /admin/members "" "$ADMIN_TOKEN"
echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  if(!JSON.parse(s).some(m=>m.displayName==="Will")) process.exit(1);
})' || die "seeded member Will missing: $BODY"
ok 4 "seed: CommandCode + Mistral + member Will"

# --- 5. wire the mock pool: provider, account, credential, model, mapping ---
req 201 POST /admin/providers "{\"displayName\":\"Smoke Mock $RUN\",\"type\":\"openai-compatible\",\"baseUrl\":\"$MOCK_URL\"}" "$ADMIN_TOKEN"
PROVIDER_ID="$(echo "$BODY" | json_get id)" || die "no provider id"
req 201 POST "/admin/providers/$PROVIDER_ID/accounts" "{\"displayName\":\"smoke-acc-$RUN\"}" "$ADMIN_TOKEN"
ACCOUNT_ID="$(echo "$BODY" | json_get id)" || die "no account id"
req 200 POST "/admin/accounts/$ACCOUNT_ID/credential" '{"apiKey":"sk-smoke-0000000000000000"}' "$ADMIN_TOKEN"
echo "$BODY" | json_get ok | grep -q '^true$' || die "credential upsert failed: $BODY"
req 201 POST /admin/models "{\"displayName\":\"smoke-model-$RUN\"}" "$ADMIN_TOKEN"
MODEL_ID="$(echo "$BODY" | json_get id)" || die "no model id"
req 201 POST "/admin/models/$MODEL_ID/mappings" "{\"accountId\":\"$ACCOUNT_ID\",\"upstreamModel\":\"smoke-upstream-x\"}" "$ADMIN_TOKEN"
MAPPING_ID="$(echo "$BODY" | json_get id)" || die "no mapping id"
req 201 POST /admin/members "{\"displayName\":\"Smoke Human $RUN\"}" "$ADMIN_TOKEN"
MEMBER_ID="$(echo "$BODY" | json_get id)" || die "no member id"
req 201 POST "/admin/members/$MEMBER_ID/keys" '{"label":"smoke-agent"}' "$ADMIN_TOKEN"
KEY_ID="$(echo "$BODY" | json_get id)" || die "no key id"
PT_TOKEN="$(echo "$BODY" | json_get token)" || die "no plaintext key in creation response"
case "$PT_TOKEN" in pt_*) ;; *) die "key token shape unexpected";; esac
# Price the smoke upstream model (merge into the existing table; restored on exit).
req 200 GET /admin/prices "" "$ADMIN_TOKEN"
PRICES_ORIG="$BODY"
PRICES_NEW="$(node -e 'const p=JSON.parse(process.argv[1]);p.push(JSON.parse(process.argv[2]));console.log(JSON.stringify({prices:p}))' \
  "$PRICES_ORIG" "{\"scope\":\"provider\",\"providerId\":\"$PROVIDER_ID\",\"modelMatcher\":\"smoke-upstream-x\",\"priceInput\":1,\"priceOutput\":2}")"
req 200 PUT /admin/prices "$PRICES_NEW" "$ADMIN_TOKEN"
ok 5 "pool wired: provider/account/credential/model/mapping/member/key + price"

# --- 6. proxied streamed request through the mock ----------------------------
curl -sN --max-time 15 -o "$TMP/stream.out" -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $PT_TOKEN" -H 'content-type: application/json' \
  -d "{\"model\":\"smoke-model-$RUN\",\"stream\":true,\"stream_options\":{\"include_usage\":true},\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
  || die "proxied request curl failed"
grep -q 'Bonjour' "$TMP/stream.out" || die "stream body missing content: $(cat "$TMP/stream.out")"
grep -q '"usage"' "$TMP/stream.out" || die "stream body missing usage chunk (client asked via stream_options)"
ok 6 "streamed chat completion via mock upstream"

# --- 7. /admin/overview reflects the row + cost ------------------------------
# capture is fire-and-forget: poll until the row lands.
EXPECT_COST="0.001152" # 1024 in @ $1 + 64 out @ $2 per 1M tokens
SEEN=""
for _ in $(seq 1 100); do
  req 200 GET /admin/overview "" "$ADMIN_TOKEN"
  if echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const o=JSON.parse(s);
    const row=o.accounts.find(a=>a.id===process.argv[1]);
    process.exit(row && row.todayRequests===1 ? 0 : 1);
  })' "$ACCOUNT_ID" 2>/dev/null; then SEEN=1; break; fi
  sleep 0.1
done
[ -n "$SEEN" ] || die "overview never showed the smoke request row: $BODY"
echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const [accountId, providerName, expectCost] = process.argv.slice(1);
  const o = JSON.parse(s);
  const row = o.accounts.find(a => a.id === accountId);
  if (!row) { console.error("account row missing"); process.exit(1); }
  if (row.provider !== providerName || row.enabled !== true || row.cooling !== false) {
    console.error("account row fields wrong:", JSON.stringify(row)); process.exit(1);
  }
  if (Math.abs(row.todayCostUsd - Number(expectCost)) > 1e-6) {
    console.error(`todayCostUsd ${row.todayCostUsd} != ${expectCost}`); process.exit(1);
  }
  if (o.today.requests < 1 || o.today.tokensIn < 1024 || o.today.tokensOut < 64) {
    console.error("today totals too small:", JSON.stringify(o.today)); process.exit(1);
  }
})' "$ACCOUNT_ID" "Smoke Mock $RUN" "$EXPECT_COST" || die "overview assertions failed: $BODY"
ok 7 "overview: 1 request on smoke account, todayCostUsd=$EXPECT_COST"

# --- 8. analytics (M2 routes; skipped while not merged) ---------------------
PROBE="$(curl -sS --max-time 10 -o "$TMP/body.json" -w "%{http_code}" "$BASE/admin/analytics/summary" \
  -H "Authorization: Bearer $ADMIN_TOKEN")" || die "analytics probe curl failed to run"

if [ "$PROBE" = "404" ]; then
  echo "SKIP analytics (endpoint not merged yet)"
else
  [ "$PROBE" = "200" ] || die "GET /admin/analytics/summary → $PROBE (want 200): $(cat "$TMP/body.json")"
  BODY="$(cat "$TMP/body.json")"
  echo "$BODY" | json_get total.requests >/dev/null || die "summary body unexpected: $BODY"

  TODAY="$(date -u +%Y-%m-%d)"
  req 200 GET "/admin/analytics/timeseries?bucket=hour&from=${TODAY}T00:00:00Z" "" "$ADMIN_TOKEN"
  echo "$BODY" | json_get series >/dev/null || die "timeseries body unexpected: $BODY"

  req 200 GET /admin/requests "" "$ADMIN_TOKEN"
  echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    if(!Array.isArray(JSON.parse(s).rows)) process.exit(1);
  })' || die "/admin/requests rows missing or not an array: $BODY"

  # SSE feed: hello event first, event-stream content type. --max-time 3
  # aborts the open stream (exit 28) once we have the first bytes — expected.
  curl -sN --max-time 3 -D "$TMP/feed.headers" -o "$TMP/feed.out" "$BASE/admin/analytics/feed" \
    -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null || true
  grep -qi 'content-type:[[:space:]]*text/event-stream' "$TMP/feed.headers" \
    || die "feed content-type unexpected: $(cat "$TMP/feed.headers")"
  head -c 4096 "$TMP/feed.out" | grep -q '^event: hello' \
    || die "feed missing hello event: $(head -c 500 "$TMP/feed.out")"
  ok 8 "analytics: summary + timeseries(hour) + requests rows + feed hello"
fi

echo "SMOKE OK (port=$PORT run=$RUN)"
