# passe•trou M1 — Proxy Core + Admin Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship passe•trou's headless dogfoodable slice: Prisma schema, full admin REST API (providers/accounts/models/mappings/members/keys/prices), the LAN proxy with load balancing across pooled accounts, SSE capture into `Request` rows, and per-request cost — verified end-to-end against a mock upstream.

**Architecture:** Hono (Node) app in an npm-workspaces monorepo; one `apps/api` package holds schema, admin API, and proxy. Proxy selects an account via authored Model→Account mappings (least-used-in-window, cooldown on 429/5xx), tees SSE chunks into an assembler, and writes one metrics-only `Request` row after completion (no payload bodies — retention is on standby). All admin behavior is REST-first; the dashboard arrives in plan M3 as a client of this API.

**Tech Stack:** Node ≥22, TypeScript strict, Hono + @hono/node-server, zod, Prisma + Postgres 16, vitest (unit + integration), tsx (dev), tsup (build). npm workspaces, no turborepo.

**Spec:** `docs/superpowers/specs/2026-11-20-passetrou-design.md` (v1.1 — plan argues from it; read it first)

## Global Constraints

- Node **≥22**; TypeScript `strict: true`; ESM (`"type": "module"`).
- Work on branch `feat/m1-proxy-core`; Conventional Commits; every task ends green (`npm test` in `apps/api`) then commits.
- Display name `passe•trou` (U+00B7) in user-visible strings; package/file names use `passe-trou`.
- LAN-only: server binds `0.0.0.0:${PORT}` (default 8787); NO auth-exposed admin beyond Bearer, NO HTTPS/tunnel code.
- Upstream `User-Agent` is always `passe-trou/<version>` (never the client's UA; Cloudflare 403s default library UAs).
- Secrets: upstream API keys stored AES-256-GCM (`ENCRYPTION_KEY`, 32-byte hex env); passe•trou keys are `pt_sk_` + 24 random hex chars, stored as sha256 hex only; plaintext shown once at creation.
- Admin endpoints under `/admin/*` require `Authorization: Bearer ${console bearer token}` (env, no Admin table).
- **Retention on standby: NEVER persist request/response/thinking bodies** — metrics columns only. No `RequestPayload` table in this schema.
- Wire formats: passthrough only. Provider `kind` must match the client edge (`openai`↔`/v1/chat/completions`, `anthropic`↔`/v1/messages`); mismatch → 400 `{error: {code: "wrong_wire_format", ...}}` naming the correct edge; NO translation.
- Failover/circuit: 429 → honor `Retry-After` else exponential 30 s→30 min cap; other 5xx → same backoff. Silent failover only before first client byte; after first byte, forward terminal error, never retry.
- Test infra: `docker-compose.dev.yml` provides Postgres 16 on `${PGPORT:-54329}` (avoid clashing with Heermes' containers — do NOT touch honcho/klui containers); vitest global setup runs `prisma migrate deploy` + truncates tables between files.

## Review Focus

1. **Client aborts mid-stream** → upstream request aborted, row still written with `status: "aborted"`, no hang, no unhandled rejection (pinned in Task 12).
2. **All pool accounts cooling down** → immediate `503 {error:{code:"pool_exhausted", retryAfterSec}}` with the min remaining cooldown — never an infinite failover loop (pinned in Task 9).
3. **Provider omits usage from the stream** (no `include_usage` support) → row written with null token fields and null cost; request still succeeds for the client (pinned in Task 10).
4. **Key/upstream-key leakage**: list/show endpoints return prefixes only; error paths and logs never include plaintext keys (pinned in Tasks 3, 4, 6).
5. **SSE chunks arriving split mid-line or coalesced** (TCP fragmentation) → assembler parses correctly regardless of chunking (pinned in Task 10).

---

### Task 1: Monorepo scaffold + dev harness

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/.env.example`, `apps/api/tests/health.test.ts`, `docker-compose.dev.yml`, `vitest.config.ts` (in `apps/api/`), `apps/api/tests/setup.ts`
- Test: `apps/api/tests/health.test.ts`

**Interfaces:**
- Produces: `createApp(): Hono` in `src/app.ts`; `env` object in `src/env.ts` (zod-parsed: `PORT=8787`, `DATABASE_URL`, `console bearer token`, `ENCRYPTION_KEY` (64 hex chars), `PGPORT=54329`); npm scripts at root: `dev`, `build`, `test`, `db:up`, `db:migrate`.

- [ ] **Step 1: Failing test** — `tests/health.test.ts`:
```ts
it("GET /health returns ok", async () => {
  const res = await createApp().request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", name: "passe•trou" });
});
```
- [ ] **Step 2: Run** `npm test` in `apps/api` → FAIL (module not found).
- [ ] **Step 3: Implement** scaffold: `src/env.ts` (zod parse, throws on missing `DATABASE_URL`/`console bearer token`/`ENCRYPTION_KEY`), `src/app.ts` (`new Hono()`, `/health`), `src/index.ts` (`serve` from `@hono/node-server`, bind `0.0.0.0`), dev `docker-compose.dev.yml` = single `postgres:16-alpine` service on `127.0.0.1:${PGPORT}:5432`, db `passetrou`, user/pass `passetrou`. Deps: `hono @hono/node-server zod`; dev: `tsx typescript vitest @types/node tsup`.
- [ ] **Step 4: Run** `npm test` → PASS. Also verify: `npm run dev` boots and `curl localhost:8787/health` returns the JSON.
- [ ] **Step 5: Commit** `chore: scaffold passe•trou monorepo (apps/api, hono, vitest, dev pg)`

### Task 2: Prisma schema + migration

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/src/db.ts`, `apps/api/tests/schema.test.ts`
- Test: `apps/api/tests/schema.test.ts`

**Interfaces:**
- Produces: `db: PrismaClient` singleton from `src/db.ts`. Models (exact names/fields, from spec Data Model, retention-excluded):

```prisma
model Provider { id String @id @default(cuid())  name String @unique  kind ProviderKind  defaultBaseUrl String?  accounts Account[]  prices PriceEntry[]  createdAt DateTime @default(now() }
enum ProviderKind { openai anthropic }
model Account { id @id cuid  providerId→Provider  label String  baseUrl String?  apiKeyEnc String  enabled Boolean @default(true)  cooledDownUntil DateTime?  createdAt  @@unique([providerId, label]) }
model Model { id @id cuid  name String @unique  description String?  enabled Boolean @default(true)  mappings ModelMapping[]  createdAt }
model ModelMapping { id @id cuid  modelId→Model  accountId→Account  upstreamModelName String  enabled Boolean @default(true)  @@unique([modelId, accountId]) }
model Member { id @id cuid  name String @unique  notes String?  keys ApiKey[]  createdAt }
model ApiKey { id @id cuid  memberId→Member  label String  prefix String  sha256 String @unique  status KeyStatus @default(active)  allowedModels ApiKeyModel[]  requests Request[]  createdAt }
enum KeyStatus { active revoked }
model ApiKeyModel { keyId→ApiKey  modelId→Model  @@id([keyId, modelId]) }
model PriceEntry { id @id cuid  providerId?→Provider  accountId?→Account  modelMatcher String  priceInput Float  priceOutput Float  priceCachedInput Float?  updatedAt @updatedAt }  // USD per 1M tokens
model Request { id @id cuid  ts DateTime @default(now())  keyId→ApiKey  memberId→Member  accountId?→Account  modelId?→Model  requestedModel String  upstreamModel String?  wireFormat ProviderKind  stream Boolean  status RequestStatus  httpStatus Int  errorCode String?  latencyMs Int  ttftMs Int?  promptTokens Int?  completionTokens Int?  reasoningTokens Int?  cachedTokens Int?  toolCallCount Int?  finishReason String?  costUsd Float?  clientName String? } // indexes on (ts), (keyId,ts), (accountId,ts), (modelId,ts), (memberId,ts)
enum RequestStatus { ok error aborted }
```
- [ ] **Step 1: Failing test** — `schema.test.ts`: insert one row into every table via `db`, read it back, assert `provider.kind === "openai"` round-trips and `Request.costUsd` accepts `null`.
- [ ] **Step 2: Run** `npm test` → FAIL (no schema).
- [ ] **Step 3: Implement** schema, `npm run db:up`, `prisma migrate dev --name init`, `src/db.ts` singleton.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: prisma schema v1 (no payload retention)`

### Task 3: Crypto lib (passe•trou keys + upstream key vault)

**Files:**
- Create: `apps/api/src/lib/keys.ts`, `apps/api/src/lib/vault.ts`, `apps/api/tests/crypto.test.ts`
- Test: `apps/api/tests/crypto.test.ts`

**Interfaces:**
- Produces:
  - `generateApiKey(): { plaintext: string; prefix: string; sha256: string }` — plaintext `pt_sk_` + 48 hex chars (24 random bytes hex); `prefix` = first 12 chars (`pt_sk_` + 6); `sha256` = hex digest of plaintext.
  - `hashKey(plaintext: string): string` (sha256 hex).
  - `encryptSecret(plain: string): string` and `decryptSecret(enc: string): string` — AES-256-GCM, key = `env.ENCRYPTION_KEY`; storage format `v1:<ivB64>:<tagB64>:<ctB64>`; decrypt throws on unknown prefix/tampered data.

- [ ] **Step 1: Failing test** — `crypto.test.ts`: key matches `/^pt_sk_[0-9a-f]{48}$/`, prefix is `plaintext.slice(0,12)`, sha256 round-trips via `hashKey`; encrypt→decrypt round-trips `"sk-live-secret"`; decrypt of a bit-flipped ciphertext throws; **assert no function returns/logs plaintext upstream keys** (only via `decryptSecret` explicitly).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** using `node:crypto` (`randomBytes`, `createHash`, `createCipherGCM`); key = `Buffer.from(env.ENCRYPTION_KEY, "hex")`, throw if length ≠ 32.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: key generation + AES-GCM secret vault`

### Task 4: Admin auth + providers & accounts CRUD

**Files:**
- Create: `apps/api/src/admin/middleware.ts`, `apps/api/src/admin/providers.ts`, `apps/api/src/admin/accounts.ts`, `apps/api/tests/admin-accounts.test.ts`
- Modify: `apps/api/src/app.ts` (mount `/admin/*`)
- Test: `apps/api/tests/admin-accounts.test.ts`

**Interfaces:**
- Consumes: `db` (T2), `encryptSecret`/`decryptSecret` (T3).
- Produces routes (all under `adminAuth` middleware — 401 `{error:{code:"unauthorized"}}` unless `Authorization: Bearer ${env.console bearer token}`):
  - `GET/POST /admin/providers`, `GET/PATCH/DELETE /admin/providers/:id` (zod body `{name, kind: "openai"|"anthropic", defaultBaseUrl?}`)
  - `GET/POST /admin/accounts`, `GET/PATCH/DELETE /admin/accounts/:id` (body `{providerId, label, baseUrl?, apiKey}`; store `apiKeyEnc`; **responses return `apiKeyPreview: prefix + "…"`, never plaintext**)
  - `POST /admin/accounts/:id/test` → decrypts key, GETs upstream `{baseUrl||provider.defaultBaseUrl}/models` with UA `passe-trou/<version>`, returns `{ok, latencyMs, models: string[]}`; on failure `{ok:false, httpStatus?, error}` — never leaks the key.

- [ ] **Step 1: Failing test** — integration (test app + real test DB): unauthorized without/with wrong token (401); create provider `CommandCode` kind `openai` defaultBaseUrl `https://api.commandcode.ai/provider/v1`; create account label `compte-1` with key `sk-test-123`; **list response contains `sk-tes…`** and nowhere the full `sk-test-123` (scan `JSON.stringify(body)`); patch `enabled:false`; delete → 404 afterwards. `/test` covered with a **mock upstream** (local Hono fixture app on ephemeral port returning `{"data":[{"id":"m1"}]}`) — assert `{ok:true, models:["m1"]}` and that the mock received UA starting with `passe-trou/`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** middleware, zod-validated routers, mask helper `maskKey(k)=k.slice(0,6)+"…"`, test endpoint with 5 s timeout (`AbortSignal.timeout(5000)`). Upstream fetch helper `src/lib/upstreamFetch.ts` sets UA header — create here, reused later.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: admin auth + providers/accounts CRUD + connection test`

### Task 5: Models & mappings CRUD

**Files:**
- Create: `apps/api/src/admin/models.ts`, `apps/api/tests/admin-models.test.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/admin-models.test.ts`

**Interfaces:**
- Consumes: T2 `db`, T4 middleware.
- Produces: `GET/POST /admin/models`, `GET/PATCH/DELETE /admin/models/:id`; `PUT /admin/models/:id/mappings` with body `{mappings: [{accountId, upstreamModelName, enabled?}]}` — **replaces the full set atomically** (transaction: delete missing, upsert rest); response includes joined account labels. Deleting a model cascades mappings; deleting an account with mappings → 409 `{error:{code:"account_in_use"}}`.

- [ ] **Step 1: Failing test** — create model `fast-flash`; PUT two mappings (two accounts, upstream names `deepseek/deepseek-v4.1-flash` and `tngtech/deepseek-r1t2-chimera:free`); GET shows both with labels; PUT a single mapping replaces the set (old one gone); delete account referenced → 409; delete model → mappings gone.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** routers + transaction via `db.$transaction`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: logical models + account mappings (authored load balancer)`

### Task 6: Members & API keys CRUD (allowlist v1)

**Files:**
- Create: `apps/api/src/admin/members.ts`, `apps/api/src/admin/keys.ts`, `apps/api/tests/admin-keys.test.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/admin-keys.test.ts`

**Interfaces:**
- Consumes: T2, T3, T4.
- Produces: `GET/POST /admin/members`, `PATCH/DELETE /admin/members/:id`; `POST /admin/keys {memberId, label, modelIds: string[]}` → **201 with `{key: "<plaintext once>"}`**; `GET /admin/keys` → id/prefix/label/member/status/`allowedModelIds` (no hash, no plaintext); `PATCH /admin/keys/:id {label?, status?, modelIds?}` (validate every id exists); `DELETE` = revoke (`status:"revoked"`). Member delete with keys → 409.

- [ ] **Step 1: Failing test** — create member `Chloé`; create key with allowlist `[fast-flash]` → response contains full `pt_sk_…` **once**, list shows only `prefix`; DB row's `sha256` length 64 and column set contains no plaintext; patch allowlist to `[]`; revoke → `GET` shows `revoked`; `modelIds:["nope"]` → 400.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** routers; on create use T3 `generateApiKey()`, store `prefix`+`sha256`; `ApiKeyModel` rows in same transaction.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: members + api keys with model allowlist`

### Task 7: PriceEntry CRUD + cost calculator

**Files:**
- Create: `apps/api/src/admin/prices.ts`, `apps/api/src/lib/cost.ts`, `apps/api/tests/cost.test.ts`, `apps/api/tests/admin-prices.test.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/cost.test.ts`, `apps/api/tests/admin-prices.test.ts`

**Interfaces:**
- Consumes: T2, T4.
- Produces:
  - `PUT /admin/prices` (bulk replace list), `GET /admin/prices` — entries `{id?, scope: "provider"|"account", providerId?, accountId?, modelMatcher, priceInput, priceOutput, priceCachedInput?}` (USD per 1M tokens; matcher = exact string or glob suffix `*`, e.g. `"claude-*"`).
  - `computeCost(args: {accountId, providerId, upstreamModel, promptTokens?, completionTokens?, cachedTokens?}): number | null` in `src/lib/cost.ts` — resolution precedence: account-scope exact > provider-scope exact > account-scope glob > provider-scope glob > null. Formula: `promptTokens`/`1M`×`priceInput` + `completionTokens`/`1M`×`priceOutput`; when `cachedTokens` present and `priceCachedInput` set, bill cached part at cached rate instead of input rate. Any token field null → return `null` (never guess).

- [ ] **Step 1: Failing test** — `cost.test.ts`: fixture prices — provider-wide `deepseek/*` at 0.14/0.28, account-specific exact `deepseek/deepseek-v4.1-flash` at 0.10/0.20 with `priceCachedInput:0.05`. Assert: 1M in + 1M out on account-exact → `0.30`; with 500k cached → `500k/1M*0.05 + 500k/1M*0.10 + 1M*0.20` = `0.275`; provider fallback → `0.42`; unknown model → `null`; null `completionTokens` → `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `cost.ts` (pure fn, prices passed in — caller loads from DB), then `prices.ts` CRUD.
- [ ] **Step 4: Run** → PASS (+ `admin-prices.test.ts`: PUT/GET round-trip, scope validation rejects entry with both ids null).
- [ ] **Step 5: Commit** `feat: hand-set pricing + per-request cost calculator`

### Task 8: Proxy auth + resolution guard

**Files:**
- Create: `apps/api/src/proxy/auth.ts`, `apps/api/src/proxy/resolve.ts`, `apps/api/tests/proxy-guard.test.ts`
- Test: `apps/api/tests/proxy-guard.test.ts`

**Interfaces:**
- Consumes: T2, T3 (`hashKey`).
- Produces:
  - `proxyAuth` middleware: `Authorization: Bearer pt_sk_…` → `hashKey` → `db.apiKey.findUnique({sha256})` with member + allowedModels; missing/unknown/`revoked` → 401 `{error:{code:"invalid_api_key"}}`. Sets `c.set("key", row)`.
  - `resolveRequest(requestedModel: string, wireFormat: ProviderKind, key)` in `src/proxy/resolve.ts` → `{model, mappings}` | throws `ApiError`:
    - model unknown or `enabled:false` → 404 `{error:{code:"model_not_found"}}` + `availableModels` list (filtered to key allowlist);
    - model not in `key.allowedModels` → 403 `{error:{code:"model_not_allowed"}}`;
    - `mappings` = enabled mappings whose account `enabled` — empty → 503 `{error:{code:"no_healthy_accounts"}}`;
    - **wire guard**: if ANY mapping's account provider `kind !== wireFormat` → those mappings are dropped; if none remain → 400 `{error:{code:"wrong_wire_format", hint:"use /v1/messages for anthropic-backed models" }}` (or `/v1/chat/completions` for openai).

- [ ] **Step 1: Failing test** — integration: no header → 401; revoked key → 401; unknown model → 404 with allowlist-filtered `availableModels`; model outside allowlist → 403; model whose only mapping is anthropic-kind, requested via openai edge → 400 `wrong_wire_format`; happy path resolves `{model, mappings}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `ApiError` class (`status`, `code`, `extra`) + `onError` mapping in `app.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: proxy auth, model resolution, allowlist + wire guards`

### Task 9: Load balancer (least-used-in-window + circuit breaker)

**Files:**
- Create: `apps/api/src/proxy/balancer.ts`, `apps/api/tests/balancer.test.ts`
- Test: `apps/api/tests/balancer.test.ts`

**Interfaces:**
- Consumes: T2, mappings from T8.
- Produces:
  - `class Balancer` (singleton in `src/proxy/balancer.ts`):
    - `pick(mappingIds: string[]): string | null` — among mappings **not cooling down**, returns the `mappingId` with fewest starts in the trailing 60 s (ties → first); `null` when all cool.
    - `recordStart(mappingId)`, `recordDone(mappingId)` — sliding-window counters in memory.
    - `trip(accountId: string, opts: {retryAfterSec?: number}): Promise<void>` — sets cooldown `retryAfterSec` else exponential per-account strikes `30 s, 60 s, … cap 1800 s`; persists `Account.cooledDownUntil` (fire-and-forget) so restarts keep 429 cooldowns; resets strikes on success via `recordDone`.
    - `cooldownRemainingSec(mappingId): number | null`.
  - Pure, no Hono deps — inject `now()` for tests.

- [ ] **Step 1: Failing test** — fake `now`: two mappings → starts distribute 1/1 then to the less-used; after `trip(A, {retryAfterSec:120})` all picks go to B; **both tripped → `pick` returns `null` and `min(cooldownRemainingSec)` is reported** (Review Focus #2); backoff doubles 30→60 and caps at 1800; success resets strikes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `Map<mappingId, number[]>` pruned on access; strikes `Map<accountId, number>`; DB write `db.account.update` in `.catch(()=>{})`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: least-used-in-window balancer with 429 circuit breaker`

### Task 10: OpenAI edge — streaming passthrough + failover + SSE assembler

**Files:**
- Create: `apps/api/src/proxy/openai.ts`, `apps/api/src/lib/sseParse.ts`, `apps/api/src/proxy/assembleOpenAI.ts`, `apps/api/tests/assemble-openai.test.ts`, `apps/api/tests/proxy-openai.test.ts`, `apps/api/tests/fixtures/mockUpstream.ts`
- Modify: `apps/api/src/app.ts`
- Test: unit `apps/api/tests/assemble-openai.test.ts`, integration `apps/api/tests/proxy-openai.test.ts`

**Interfaces:**
- Consumes: T4 (`upstreamFetch`), T8, T9.
- Produces:
  - `parseSSE(onEvent): (chunk: Uint8Array) => void` in `src/lib/sseParse.ts` — incremental line buffering, **correct under arbitrary TCP chunk splits/coalescing** (Review Focus #5); emits parsed `{event?, data}` objects, handles `data: [DONE]`.
  - `class OpenAIAssembler`: `feed(chunk)`, snapshot `{ttftMs, usage?: {prompt_tokens, completion_tokens, reasoning_tokens?, cached_tokens?}, toolCallCount, finishReason, modelServed?}` — usage from the terminal usage chunk or non-stream body; `toolCallCount` = unique tool-call indices seen in deltas; TTFT = first content/reasoning delta.
  - `POST /v1/chat/completions` in `src/proxy/openai.ts`: T8 guards → `balancer.pick` → upstream `POST /models-endpoint/chat/completions` with body `{...clientBody, model: mapping.upstreamModelName}`; if `stream:true`, force-add `stream_options.include_usage: true` upstream but **forward the usage chunk to the client only if the client originally set `stream_options`**; pipe chunks client-side immediately, `assembler.feed` in parallel.
  - Failover: upstream non-2xx with no bytes sent → `balancer.trip(accountId, {retryAfterSec from Retry-After})` on 429/5xx, retry next `pick` from remaining mappings (max once per mapping); 429/5xx response with no alternates → forward status + body. After first byte sent → no retry; end stream.
  - `pick` → null → 503 `{error:{code:"pool_exhausted", retryAfterSec}}` (Review Focus #2).

- [ ] **Step 1: Failing unit test** — `assemble-openai.test.ts`: fixture = recorded CommandCode-shaped stream (reasoning delta, content deltas, one tool-call across 3 chunks, terminal usage chunk with `completion_tokens_details.reasoning_tokens=12`, `prompt_tokens_details.cached_tokens=512`); assert `ttftMs > 0` at first delta, `toolCallCount=1`, usage fields extracted; **feed identical bytes as 1-byte chunks → identical snapshot**; non-stream body variant too.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `sseParse.ts` + `assembleOpenAI.ts`.
- [ ] **Step 4: Run** units → PASS.
- [ ] **Step 5: Failing integration test** — `fixtures/mockUpstream.ts`: Hono app with `POST /:anything/chat/completions` modes: canned SSE stream (with delay), canned SSE **without** usage chunk (Review Focus #3: proxied request succeeds, assembler usage undefined), instant `429` + `Retry-After: 45`, instant `500`. Proxy tests: happy-path streamed response reaches client with expected text; client sees usage chunk only when it asked; 429 account A → silent failover to B (client gets 200) AND A tripped 45 s in balancer; both 429 → forwarded 429 + Retry-After; **model rewrite**: mock asserts it received the `upstreamModelName`, not the logical name; wrong-wire mapping → 400 before any upstream call.
- [ ] **Step 6: Run** → FAIL.
- [ ] **Step 7: Implement** `proxy/openai.ts` route + stream piping (`c.body(readable)`), abort propagation via `AbortController`.
- [ ] **Step 8: Run** integration suite → PASS.
- [ ] **Step 9: Commit** `feat: openai edge — passthrough streaming, failover, usage capture`

### Task 11: Anthropic edge — `/v1/messages` + assembler

**Files:**
- Create: `apps/api/src/proxy/anthropic.ts`, `apps/api/src/proxy/assembleAnthropic.ts`, `apps/api/tests/assemble-anthropic.test.ts`, `apps/api/tests/proxy-anthropic.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/tests/fixtures/mockUpstream.ts` (add `POST /v1/messages` modes)
- Test: `apps/api/tests/assemble-anthropic.test.ts`, `apps/api/tests/proxy-anthropic.test.ts`

**Interfaces:**
- Consumes: T8, T9, T10 `sseParse`.
- Produces: `POST /v1/messages` (same guard/balancer/failover flow, anthropic-kind mappings only); `AnthropicAssembler` with snapshot `{ttftMs (first content/thinking delta), usage, thinkingTokens?, toolCallCount (tool_use blocks), stopReason}` — usage assembled from `message_start.usage` + final `message_delta.usage`; `anthropic-beta`/`anthropic-version` headers forwarded upstream.

- [ ] **Step 1: Failing unit test** — fixture: `message_start` (usage.input_tokens=100), thinking delta, text deltas, one `tool_use` across 2 `content_block_delta`s, `message_delta` (usage.output_tokens=42, stop_reason "tool_use"), `message_stop`; assert usage `{prompt:100, completion:42}`, thinking counted in `reasoningTokens` bucket, `toolCallCount=1`; byte-split invariance.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** assembler + route.
- [ ] **Step 4: Run** units → PASS.
- [ ] **Step 5: Failing integration test** — proxied stream OK; openai-kind-only logical model via `/v1/messages` → 400 `wrong_wire_format`; non-stream body proxies with usage captured.
- [ ] **Step 6: Run** → FAIL → implement → PASS.
- [ ] **Step 7: Commit** `feat: anthropic edge /v1/messages with thinking + tool_use capture`

### Task 12: Capture pipeline — Request rows + cost + abort handling

**Files:**
- Create: `apps/api/src/proxy/capture.ts`, `apps/api/tests/capture.test.ts`
- Modify: `apps/api/src/proxy/openai.ts`, `apps/api/src/proxy/anthropic.ts` (call capture at terminal points)
- Test: `apps/api/tests/capture.test.ts`

**Interfaces:**
- Consumes: T7 `computeCost`, T10/T11 assemblers, T8 resolution context.
- Produces: `recordRequest(ctx: CaptureCtx): void` in `src/proxy/capture.ts` — **fire-and-forget** (`.catch(log)`), never awaited in the chunk loop. `CaptureCtx = {key, model, mapping?, wireFormat, stream, startedAt, ttftMs?, usage?, toolCallCount?, finishReason?, httpStatus, outcome: "ok"|"error"|"aborted", errorCode?, clientName? }`; `memberId` snapshotted from the key; map anthropic usage → same columns; `costUsd` = `computeCost` with freshest prices (`db.priceEntry.findMany`, 30 s in-memory cache). Errors before any mapping (`invalid_api_key`, wrong wire 400s…) → row with `accountId:null, modelId:null`. Client disconnect detection: `c.req.raw.signal` / stream cancel → `outcome:"aborted"`, upstream `AbortController.abort()`, row still written (Review Focus #1).

- [ ] **Step 1: Failing test** — through the real proxy (mock upstream): stream request → exactly one row: `status ok`, token fields match fixture, `ttftMs`/`latencyMs` set, `costUsd` computed from seeded PriceEntry (Task 7 values → `0.275`); 429-failover → row records **serving account B**; upstream 400 (client error) → row `status error`, no retry; client aborts mid-stream (cancel reader) → `aborted` row, mock upstream sees disconnect, no hanging open handles (`expect(process.listenerCount..."` or vitest `onTestFinished` handle check); unknown-key request → 401 row with nulls.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** capture + wire into both edges (`finally`-style terminal hook).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: request capture pipeline with cost + abort accounting`

### Task 13: `/v1/models` per key + `/v1/embeddings` passthrough

**Files:**
- Create: `apps/api/src/proxy/modelsList.ts`, `apps/api/src/proxy/embeddings.ts`, `apps/api/tests/models-embeddings.test.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/models-embeddings.test.ts`

**Interfaces:**
- Consumes: T8 auth, T9/T10 helpers.
- Produces: `GET /v1/models` → `{object:"list", data:[{id, object:"model", created, owned_by:"passe•trou"}]}` listing **only the key's allowlisted, enabled models**; `POST /v1/embeddings` → model must be allowlisted + mapped to an openai-kind account; passthrough non-stream, usage captured via Task 12 (`completionTokens:null`, cost from prompt tokens only).

- [ ] **Step 1: Failing test** — key allowed `[fast-flash]` out of `[fast-flash, brain-pro]` → list returns exactly `fast-flash`; embeddings happy path captures `promptTokens` and row; embeddings on model with only anthropic-kind mapping → 400 `wrong_wire_format`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both routes.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: per-key model list + embeddings passthrough`

### Task 14: Admin overview + seed script + API.md + smoke verification

**Files:**
- Create: `apps/api/src/admin/overview.ts`, `apps/api/prisma/seed.ts`, `API.md` (repo root), `scripts/smoke.sh`, `apps/api/tests/overview.test.ts`
- Modify: `apps/api/src/app.ts`, `README.md` (dev-run section)
- Test: `apps/api/tests/overview.test.ts`

**Interfaces:**
- Consumes: all admin routes.
- Produces: `GET /admin/overview` → `{counts:{providers, accounts, models, members, keys}, today:{requests, tokensIn, tokensOut, costUsd}, accounts:[{id,label,provider,enabled,cooling:boolean, todayRequests, todayCostUsd}]}` (SQL `groupBy`, computed on the fly — no rollup tables in M1). `seed.ts`: idempotent presets — providers `CommandCode` (openai, `https://api.commandcode.ai/provider/v1`) + `Mistral` (openai, `https://api.mistral.ai/v1`) + one demo member `Will`. `API.md`: every route, auth, example curls. `scripts/smoke.sh`: boots app on test port against dev DB, runs 6 curls (health, unauthorized 401, seed, create account/model/mapping/member/key, proxied request against `mockUpstream` fixture, `/admin/overview` shows the row's cost) and exits non-zero on any failure.

- [ ] **Step 1: Failing test** — `overview.test.ts`: seed + run 3 proxied requests (2 models, 2 accounts) via mock → overview counts + today aggregates match (`costUsd` sum within 1e-6).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** route + seed + API.md + smoke.sh + README section (Node ≥22, `npm run db:up && npm run dev`, env vars).
- [ ] **Step 4: Run** `npm test` → PASS; `bash scripts/smoke.sh` → exit 0.
- [ ] **Step 5: Commit** `feat: admin overview, seed presets, API docs, smoke script`

---

## Definition of done (M1)

`npm test` green; `bash scripts/smoke.sh` exit 0; one `pt_sk_` key can drive end-to-end `chat/completions` + `messages` streams against a real LAN upstream; admin API covers accounts/models/mappings/members/keys/prices; every request visible with cost in `/admin/overview`. Dashboard (M3) and analytics read-API + live feed (M2) are separate plans.
