# passe•trou API reference

Base URL: `http://<lan-host>:8477` (default port; `PORT` env changes it). LAN-only, plain HTTP by design.

Three auth modes:

| Mode | Header | Scope |
|------|--------|-------|
| none | — | `GET /healthz`, `GET /db/health` |
| admin | `Authorization: Bearer $ADMIN_TOKEN` | every `/admin/*` route |
| member key | `Authorization: Bearer pt_xxxxxx…` | every `/v1/*` route |

Every error body is `{ "error": { "code": "...", "message": "..." } }` (proxy errors may add fields, e.g. `retryAfterSec`, `availableModels`, `hint`). Examples below assume:

```bash
export PT=http://127.0.0.1:8477
export ADMIN_TOKEN=…            # env on the server side too
```

## Infra (no auth)

```bash
curl $PT/healthz                              # {"ok":true}
curl $PT/db/health                            # {"ok":true} or 503 db_unavailable
```

## Admin — providers

Wire type: `openai-compatible` (served via `/v1/chat/completions` + `/v1/embeddings`) or `anthropic-compatible` (served via `/v1/messages`).

```bash
curl -X POST $PT/admin/providers -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"displayName":"CommandCode","type":"openai-compatible","baseUrl":"https://api.commandcode.ai/provider/v1"}'
curl $PT/admin/providers -H "Authorization: Bearer $ADMIN_TOKEN"
curl $PT/admin/providers/PROVIDER_ID -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH $PT/admin/providers/PROVIDER_ID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"displayName":"Mistral"}'
curl -X DELETE $PT/admin/providers/PROVIDER_ID -H "Authorization: Bearer $ADMIN_TOKEN"   # 409 while it has accounts
```

Response shape: `{id, displayName, type, baseUrl, createdAt, updatedAt}`.

## Admin — accounts (upstream subscriptions)

```bash
curl -X POST $PT/admin/providers/PROVIDER_ID/accounts -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"displayName":"compte-1","status":"active"}'
curl $PT/admin/providers/PROVIDER_ID/accounts -H "Authorization: Bearer $ADMIN_TOKEN"
curl $PT/admin/accounts/ACCOUNT_ID -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH $PT/admin/accounts/ACCOUNT_ID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"status":"benched"}'   # bench without deleting
curl -X DELETE $PT/admin/accounts/ACCOUNT_ID -H "Authorization: Bearer $ADMIN_TOKEN"   # 409 while it has mappings
```

Response: `{id, providerId, displayName, status, keyPrefix, createdAt, updatedAt}` — never the key material, only its first 8 chars.

### Account credential (upstream API key)

Plaintext enters here, is encrypted at rest (AES-256-GCM), and is never returned.

```bash
curl -X POST $PT/admin/accounts/ACCOUNT_ID/credential -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"apiKey":"sk-..."}'    # → {ok:true, keyPrefix:"sk-..."}
curl -X DELETE $PT/admin/accounts/ACCOUNT_ID/credential -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Connection test

Real upstream probe (`GET {baseUrl}/models`, 5 s timeout):

```bash
curl -X POST $PT/admin/accounts/ACCOUNT_ID/test -H "Authorization: Bearer $ADMIN_TOKEN"   # → {ok, httpStatus?, latencyMs}
```

## Admin — models & mappings (the authored load balancer)

```bash
curl -X POST $PT/admin/models -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"displayName":"fast-flash"}'
curl $PT/admin/models -H "Authorization: Bearer $ADMIN_TOKEN"
curl $PT/admin/models/MODEL_ID -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH $PT/admin/models/MODEL_ID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}'
curl -X DELETE $PT/admin/models/MODEL_ID -H "Authorization: Bearer $ADMIN_TOKEN"   # 409 while mapped / in a key allowlist

curl -X POST $PT/admin/models/MODEL_ID/mappings -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"accountId":"ACCOUNT_ID","upstreamModel":"deepseek/deepseek-v4.1-flash"}'   # upstreamModel optional, defaults to the logical name
curl -X DELETE $PT/admin/mappings/MAPPING_ID -H "Authorization: Bearer $ADMIN_TOKEN"
```

Model read: `{id, displayName, enabled, createdAt, updatedAt, mappings:[{id, accountId, accountName, providerName, providerType, accountEnabled, upstreamModel}]}`. One logical model mapped to N accounts = its serving pool (least-used-in-window, cooldown on 429/5xx).

## Admin — members & API keys

Members are people (attribution only, no login). Keys are `pt_xxxxxx…` bearers, stored as SHA-256 only; the plaintext appears exactly once, in the creation response's `token` field.

```bash
curl -X POST $PT/admin/members -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"displayName":"Will"}'
curl $PT/admin/members -H "Authorization: Bearer $ADMIN_TOKEN"
curl $PT/admin/members/MEMBER_ID -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH $PT/admin/members/MEMBER_ID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}'
curl -X DELETE $PT/admin/members/MEMBER_ID -H "Authorization: Bearer $ADMIN_TOKEN"   # 409 while it has keys

curl -X POST $PT/admin/members/MEMBER_ID/keys -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"label":"opencode-worker-3"}'   # 201 → {…, "token":"pt_xxxxxx…"} once
curl $PT/admin/members/MEMBER_ID/keys -H "Authorization: Bearer $ADMIN_TOKEN"
curl $PT/admin/keys/KEY_ID -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH $PT/admin/keys/KEY_ID -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}'   # disable = immediate 401s
curl -X DELETE $PT/admin/keys/KEY_ID -H "Authorization: Bearer $ADMIN_TOKEN"
```

Key read shape: `{id, keyPrefix, label, enabled, createdAt}` — prefix for display only.

### Per-key model allowlist

Empty = wildcard (every enabled model allowed). Non-empty = exactly those models.

```bash
curl -X PUT $PT/admin/keys/KEY_ID/models -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"modelIds":["MODEL_ID"]}'
curl $PT/admin/keys/KEY_ID/models -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Admin — prices (hand-set, USD per 1M tokens)

Bulk replace: the list you PUT **is** the price table. Entries carrying an existing `id` update in place; missing rows are deleted. `modelMatcher` = exact upstream model name or a single trailing-glob (`claude-*`). Resolution at capture time: account-exact > provider-exact > account-glob > provider-glob.

```bash
curl $PT/admin/prices -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PUT $PT/admin/prices -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{
  "prices":[
    {"scope":"provider","providerId":"PROVIDER_ID","modelMatcher":"deepseek/*","priceInput":0.14,"priceOutput":0.28},
    {"scope":"account","accountId":"ACCOUNT_ID","modelMatcher":"deepseek/deepseek-v4.1-flash","priceInput":0.10,"priceOutput":0.20,"priceCachedInput":0.05}
  ]}'
```

## Admin — overview

Live aggregates from `Request` rows (UTC midnight boundary, SQL groupBy — no rollup tables):

```bash
curl $PT/admin/overview -H "Authorization: Bearer $ADMIN_TOKEN"
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
