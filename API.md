# passe•trou API reference

Base URL: `http://<lan-host>:8477` (default port; `PORT` env changes it). LAN-only, plain HTTP by design.

Three auth modes:

| Mode | Credential | Scope |
|------|------------|-------|
| none | — | `GET /healthz`, `GET /db/health`, `GET /auth/status`, `POST /auth/register` (first boot only), `POST /auth/login` |
| console session | `Authorization: Bearer $SESSION_TOKEN` or `pt_session` cookie | every `/admin/*` route, `GET /auth/me`, `POST /auth/logout` |
| member key | `Authorization: Bearer pt_xxxxxx…` | every `/v1/*` route |

Console auth: first boot is open — `POST /auth/register {email, name, password}` creates the
admin account and closes registration (later attempts → 403 `registration_closed`). After that,
`POST /auth/login {email, password}` issues a session token (30d TTL, also set as the
`pt_session` HttpOnly cookie). `POST /auth/logout` revokes it.

Every error body is `{ "error": { "code": "...", "message": "..." } }` (proxy errors may add fields, e.g. `retryAfterSec`, `availableModels`, `hint`). Examples below assume:

```bash
export PT=http://127.0.0.1:8477
export SESSION_TOKEN=$(curl -s -X POST $PT/auth/login -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' | jq -r .token)
```

## Infra (no auth)

```bash
curl $PT/healthz                              # {"ok":true}
curl $PT/db/health                            # {"ok":true} or 503 db_unavailable
```

## Admin — providers

Wire type: `openai-compatible` (served via `/v1/chat/completions` + `/v1/embeddings`) or `anthropic-compatible` (served via `/v1/messages`).

```bash
curl -X POST $PT/admin/providers -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' \
  -d '{"displayName":"CommandCode","type":"openai-compatible","baseUrl":"https://api.commandcode.ai/provider/v1"}'
curl $PT/admin/providers -H "Authorization: Bearer $SESSION_TOKEN"
curl $PT/admin/providers/PROVIDER_ID -H "Authorization: Bearer $SESSION_TOKEN"
curl -X PATCH $PT/admin/providers/PROVIDER_ID -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"displayName":"Mistral"}'
curl -X DELETE $PT/admin/providers/PROVIDER_ID -H "Authorization: Bearer $SESSION_TOKEN"   # 409 while it has accounts
```

Response shape: `{id, displayName, type, baseUrl, createdAt, updatedAt}`.

## Admin — accounts (upstream subscriptions)

```bash
curl -X POST $PT/admin/providers/PROVIDER_ID/accounts -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' \
  -d '{"displayName":"compte-1","status":"active"}'
curl $PT/admin/providers/PROVIDER_ID/accounts -H "Authorization: Bearer $SESSION_TOKEN"
curl $PT/admin/accounts/ACCOUNT_ID -H "Authorization: Bearer $SESSION_TOKEN"
curl -X PATCH $PT/admin/accounts/ACCOUNT_ID -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"status":"benched"}'   # bench without deleting
curl -X DELETE $PT/admin/accounts/ACCOUNT_ID -H "Authorization: Bearer $SESSION_TOKEN"   # 409 while it has mappings
```

Response: `{id, providerId, displayName, status, keyPrefix, createdAt, updatedAt}` — never the key material, only its first 8 chars.

### Account credential (upstream API key)

Plaintext enters here, is encrypted at rest (AES-256-GCM), and is never returned.

```bash
curl -X POST $PT/admin/accounts/ACCOUNT_ID/credential -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"apiKey":"sk-..."}'    # → {ok:true, keyPrefix:"sk-..."}
curl -X DELETE $PT/admin/accounts/ACCOUNT_ID/credential -H "Authorization: Bearer $SESSION_TOKEN"
```

### Connection test

Real upstream probe (`GET {baseUrl}/models`, 5 s timeout):

```bash
curl -X POST $PT/admin/accounts/ACCOUNT_ID/test -H "Authorization: Bearer $SESSION_TOKEN"   # → {ok, httpStatus?, latencyMs}
```

## Admin — models & mappings (the authored load balancer)

```bash
curl -X POST $PT/admin/models -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"displayName":"fast-flash"}'
curl $PT/admin/models -H "Authorization: Bearer $SESSION_TOKEN"
curl $PT/admin/models/MODEL_ID -H "Authorization: Bearer $SESSION_TOKEN"
curl -X PATCH $PT/admin/models/MODEL_ID -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}'
curl -X DELETE $PT/admin/models/MODEL_ID -H "Authorization: Bearer $SESSION_TOKEN"   # 409 while mapped / in a key allowlist

curl -X POST $PT/admin/models/MODEL_ID/mappings -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' \
  -d '{"accountId":"ACCOUNT_ID","upstreamModel":"deepseek/deepseek-v4.1-flash"}'   # upstreamModel optional, defaults to the logical name
curl -X DELETE $PT/admin/mappings/MAPPING_ID -H "Authorization: Bearer $SESSION_TOKEN"
```

Model read: `{id, displayName, enabled, createdAt, updatedAt, mappings:[{id, accountId, accountName, providerName, providerType, accountEnabled, upstreamModel}]}`. One logical model mapped to N accounts = its serving pool (least-used-in-window, cooldown on 429/5xx).

## Admin — members & API keys

Members are people (attribution only, no login). Keys are `pt_xxxxxx…` bearers, stored as SHA-256 only; the plaintext appears exactly once, in the creation response's `token` field.

```bash
curl -X POST $PT/admin/members -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"displayName":"Will"}'
curl $PT/admin/members -H "Authorization: Bearer $SESSION_TOKEN"
curl $PT/admin/members/MEMBER_ID -H "Authorization: Bearer $SESSION_TOKEN"
curl -X PATCH $PT/admin/members/MEMBER_ID -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}'
curl -X DELETE $PT/admin/members/MEMBER_ID -H "Authorization: Bearer $SESSION_TOKEN"   # 409 while it has keys

curl -X POST $PT/admin/members/MEMBER_ID/keys -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"label":"opencode-worker-3"}'   # 201 → {…, "token":"pt_xxxxxx…"} once
curl $PT/admin/members/MEMBER_ID/keys -H "Authorization: Bearer $SESSION_TOKEN"
curl $PT/admin/keys/KEY_ID -H "Authorization: Bearer $SESSION_TOKEN"
curl -X PATCH $PT/admin/keys/KEY_ID -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}'   # disable = immediate 401s
curl -X DELETE $PT/admin/keys/KEY_ID -H "Authorization: Bearer $SESSION_TOKEN"
```

Key read shape: `{id, keyPrefix, label, enabled, createdAt}` — prefix for display only.

### Per-key model allowlist

Empty = wildcard (every enabled model allowed). Non-empty = exactly those models.

```bash
curl -X PUT $PT/admin/keys/KEY_ID/models -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{"modelIds":["MODEL_ID"]}'
curl $PT/admin/keys/KEY_ID/models -H "Authorization: Bearer $SESSION_TOKEN"
```

## Admin — prices (hand-set, USD per 1M tokens)

Bulk replace: the list you PUT **is** the price table. Entries carrying an existing `id` update in place; missing rows are deleted. `modelMatcher` = exact upstream model name or a single trailing-glob (`claude-*`). Resolution at capture time: account-exact > provider-exact > account-glob > provider-glob.

```bash
curl $PT/admin/prices -H "Authorization: Bearer $SESSION_TOKEN"
curl -X PUT $PT/admin/prices -H "Authorization: Bearer $SESSION_TOKEN" -H 'content-type: application/json' -d '{
  "prices":[
    {"scope":"provider","providerId":"PROVIDER_ID","modelMatcher":"deepseek/*","priceInput":0.14,"priceOutput":0.28},
    {"scope":"account","accountId":"ACCOUNT_ID","modelMatcher":"deepseek/deepseek-v4.1-flash","priceInput":0.10,"priceOutput":0.20,"priceCachedInput":0.05}
  ]}'
```

## Admin — overview

Live aggregates from `Request` rows (UTC midnight boundary, SQL groupBy — no rollup tables):

```bash
curl $PT/admin/overview -H "Authorization: Bearer $SESSION_TOKEN"
```

```json
{
  "counts": {"providers": 2, "accounts": 3, "models": 2, "members": 2, "keys": 4},
  "today": {"requests": 137, "tokensIn": 4102310, "tokensOut": 88211, "costUsd": 1.2314},
  "accounts": [
    {"id": "…", "label": "compte-1", "provider": "CommandCode", "enabled": true, "cooling": false, "todayRequests": 96, "todayCostUsd": 0.8123}
  ]
}
```

## Admin — analytics

All four are admin Bearer. Metrics only — never any prompt/response content (none is persisted). All timestamps ISO 8601 UTC; invalid query params → 400.

### `GET /admin/analytics/summary` — grouped aggregates

Query params: `groupBy` = `provider|account|model|key|member` (default `provider`) · `from`,`to` ISO datetimes (default `from` = now−7d, `to` = now) — 400 on unparseable dates or `from ≥ to`.

```bash
curl "$PT/admin/analytics/summary?groupBy=account&from=2026-11-13T00:00:00Z&to=2026-11-20T00:00:00Z" -H "Authorization: Bearer $SESSION_TOKEN"
```

```json
{
  "from": "2026-11-13T00:00:00.000Z", "to": "2026-11-20T00:00:00.000Z", "groupBy": "account",
  "total": {"requests": 137, "errors": 2, "errorRate": 0.0146, "promptTokens": 4102310, "completionTokens": 88211, "reasoningTokens": 0, "cachedTokens": 1024, "toolCalls": 3, "costUsd": 1.2314, "avgLatencyMs": 842, "p95LatencyMs": 2103, "avgTtftMs": 311, "p95TtftMs": 690},
  "rows": [
    {"key": "ACCOUNT_ID", "label": "compte-1", "requests": 96, "errors": 1, "errorRate": 0.0104, "promptTokens": 2900000, "completionTokens": 60210, "reasoningTokens": 0, "cachedTokens": 512, "toolCalls": 2, "costUsd": 0.8123, "avgLatencyMs": 801, "p95LatencyMs": 1950, "avgTtftMs": 298, "p95TtftMs": 640}
  ]
}
```

Every row carries the same metric fields as `total`. Token fields sum nulls as 0; `costUsd` rounded to 6 decimals; avg/p95 over `latencyMs`, and over non-null `ttftMs` only (null when the group has no ttft data). Deleted entities group under their raw id with `label: null`. Rows sort by `costUsd` desc. Empty window → zeroed `total` + empty `rows` (not an error).

### `GET /admin/analytics/timeseries` — bucketed series

Query params: `metric` = `requests|tokens|cost|latency` (default `requests`) · `bucket` = `hour|day` (default `hour`) · `from`,`to` (default now−24h for `hour`, now−30d for `day`) · optional `groupBy` = `provider|account|model|key|member`.

```bash
curl "$PT/admin/analytics/timeseries?metric=cost&bucket=hour" -H "Authorization: Bearer $SESSION_TOKEN"
```

```json
{
  "from": "2026-11-19T10:00:00.000Z", "to": "2026-11-20T10:00:00.000Z", "bucket": "hour", "metric": "cost",
  "series": [
    {"key": "all", "label": null, "points": [{"ts": "2026-11-19T10:00:00.000Z", "value": 0}, {"ts": "2026-11-19T11:00:00.000Z", "value": 0.2031}]}
  ]
}
```

Every bucket in `from..to` is present, zero-filled. `value` = count for `requests`, prompt+completion sum for `tokens`, 6-decimal cost sum for `cost`. For `latency` each point is `{"ts", "avg", "p95"}` (nulls on empty buckets) instead of `value`. With `groupBy`: one series per group in the window (labels resolved as in summary), sorted by total value desc, capped at 25 series. Ungrouped → single series with `key: "all"`, `label: null`.

### `GET /admin/requests` — paginated request log

Query params: `from`,`to` ISO · `keyId`,`memberId`,`accountId`,`modelId` · `status` = `ok|error|aborted` · `stream` = `true|false` · `errorCode` string · `minLatencyMs` int · `limit` int ≤ 200 (default 50) · `cursor` opaque (invalid → 400).

```bash
curl "$PT/admin/requests?memberId=MEMBER_ID&status=error&limit=10" -H "Authorization: Bearer $SESSION_TOKEN"
```

```json
{
  "rows": [
    {"id": "…", "ts": "2026-11-20T09:58:11.000Z", "requestedModel": "fast-flash", "upstreamModel": "deepseek/deepseek-v4.1-flash", "wireFormat": "openai-compatible", "stream": true, "status": "ok", "httpStatus": 200, "errorCode": null, "latencyMs": 812, "ttftMs": 290, "promptTokens": 1024, "completionTokens": 64, "reasoningTokens": 0, "cachedTokens": 0, "toolCallCount": 0, "finishReason": "stop", "costUsd": 0.001152, "clientName": "opencode-worker-3",
      "key": {"id": "…", "label": "smoke-agent", "prefix": "pt_abcd1234"},
      "member": {"id": "…", "name": "Will"},
      "account": {"id": "…", "displayName": "compte-1", "provider": "CommandCode"},
      "model": {"id": "…", "name": "fast-flash"}}
  ],
  "nextCursor": null
}
```

Newest first (`ts DESC, id DESC`); key/member/account/model are `null` when the entity was deleted (FKs SetNull). Cursor pagination is stable under concurrent inserts: pass `nextCursor` back as `cursor`; it is `null` when fewer rows than `limit` came back.

### `GET /admin/analytics/feed` — live SSE stream

Server-Sent Events. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.

```bash
curl -N "$PT/admin/analytics/feed" -H "Authorization: Bearer $SESSION_TOKEN"
```

On connect, one `hello` event:

```
event: hello
data: {"ok":true,"ts":"2026-11-20T10:00:00.000Z"}
```

Then one `request` event per captured proxied call, as it lands:

```
event: request
data: {"id":"…","ts":"…","requestedModel":"fast-flash","upstreamModel":"deepseek/deepseek-v4.1-flash","wireFormat":"openai-compatible","stream":true,"status":"ok","httpStatus":200,"latencyMs":812,"ttftMs":290,"promptTokens":1024,"completionTokens":64,"costUsd":0.001152,"keyId":"…","memberId":"…","accountId":"…","modelId":"…"}
```

A `: ping` heartbeat comment is sent every 15 s so idle connections survive proxies/browsers. No replay buffer: events missed while disconnected are lost — backfill via `GET /admin/requests`.

## Proxy — member key (`pt_xxxxxx…`) auth

Passthrough only, no wire translation: request the edge matching the backing provider's type or get `400 wrong_wire_format` with a `hint`. Optional `x-client-name: <your-agent>` headers attribute rows in the feed. Every call lands one metrics-only `Request` row (bodies are never persisted).

### `POST /v1/chat/completions` (openai-compatible pool)

Streams passthrough; when `stream:true` the proxy forces `stream_options.include_usage` upstream (usage accounting) and forwards the usage chunk only if you set `stream_options` yourself.

```bash
curl -N $PT/v1/chat/completions -H "Authorization: Bearer pt_xxxxxx…" -H 'content-type: application/json' \
  -d '{"model":"fast-flash","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

### `POST /v1/messages` (anthropic-compatible pool)

`anthropic-version` / `anthropic-beta` headers are forwarded upstream.

```bash
curl -N $PT/v1/messages -H "Authorization: Bearer pt_xxxxxx…" -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-pool","max_tokens":256,"stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

### `GET /v1/models`

Only enabled models this key may use (allowlist-filtered):

```bash
curl $PT/v1/models -H "Authorization: Bearer pt_xxxxxx…"   # {"object":"list","data":[{"id":"fast-flash","object":"model",…}]}
```

### `POST /v1/embeddings`

Non-stream passthrough on openai-compatible mappings; usage billed on prompt tokens.

```bash
curl $PT/v1/embeddings -H "Authorization: Bearer pt_xxxxxx…" -H 'content-type: application/json' \
  -d '{"model":"embed-small","input":"hello"}'
```

## Proxy error codes

| HTTP | code | meaning |
|------|------|---------|
| 401 | `invalid_api_key` | missing/unknown/disabled key (or disabled member) |
| 403 | `model_not_allowed` | outside the key allowlist |
| 404 | `model_not_found` | unknown/disabled logical model (`availableModels` included) |
| 400 | `wrong_wire_format` | used the wrong edge for this model's backends (`hint` included) |
| 503 | `no_healthy_accounts` | model has no enabled mappings/accounts |
| 503 | `pool_exhausted` | all accounts cooling (`retryAfterSec` + `Retry-After` header) |

On upstream 429/5xx the account cools down (`Retry-After` honored, else 30 s exponential to 30 min) and the request silently fails over to the next pooled account — but only before the first byte; mid-stream failures surface as-is.
