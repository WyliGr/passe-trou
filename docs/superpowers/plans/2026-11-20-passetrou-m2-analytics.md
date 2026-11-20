# passe•trou — M2: Analytics read layer + live feed

**Status:** in progress — **Branch:** `dev` → PRs into `main`

## Goal

Read-only analytics API over the `requests` table: grouped summaries, time series, paginated request log, and a live SSE feed — everything the M3 dashboard will consume.

## Constraints

- Metrics-only, read-only. No schema change (the `Request` model already carries everything).
- All endpoints under `/admin/*`, admin Bearer auth, same middleware as existing admin routes.
- No raw prompt/response content is ever stored or returned (invariant).
- Raw SQL (`$queryRaw`) for aggregates/percentiles — Prisma groupBy is too weak for p95.
- Tests: vitest with the existing test DB setup; worker gates: typecheck 0 err, tests green, lint.

## Contract

Auth: `Authorization: Bearer <ADMIN_TOKEN>` on everything below. Time params: `from`, `to` as ISO 8601 (default: last 7 days). All responses JSON except the feed.

### T1 — `GET /admin/analytics/summary` (w08)
Query: `groupBy` = `provider|account|model|key|member` (default `provider`), `from`, `to`.
Response: `{ from, to, total: {...}, rows: [{ key, label, requests, errors, errorRate, promptTokens, completionTokens, reasoningTokens, cachedTokens, toolCalls, costUsd, avgLatencyMs, p95LatencyMs, avgTtftMs, p95TtftMs }] }` ordered by costUsd desc. `key`/`label` resolve the FK to a readable name; deleted entities keep their id as key with label `null`.

### T2 — timeseries + request log (w09)
- `GET /admin/analytics/timeseries?metric=requests|tokens|cost|latency&bucket=hour|day&from&to&groupBy=<axis>?` → `{ from, to, bucket, series: [{ key, label, points: [{ ts, value }] }] }`, zero-filled buckets, latency metric returns avg + p95 per bucket (`value` = object then).
- `GET /admin/requests?from&to&keyId&memberId&accountId&modelId&status&stream&minLatencyMs&cursor&limit(≤200)` → `{ rows: [...], nextCursor }` newest first. Rows carry the resolved labels (member/key prefix/model/account) to avoid N joins client-side.

### T3 — live feed (w10)
- `GET /admin/analytics/feed` → SSE. In-process `EventEmitter`; `capture.ts` emits `request` after each persisted row (async, failures swallowed, never blocks the client path). Feed broadcasts { id, ts, requestedModel, status, latencyMs, ttftMs, costUsd, keyId, memberId, accountId, modelId } as `event: request`. Heartbeat comment every 15s. Multiple concurrent subscribers. Client backfill is T2's `/admin/requests` — the feed carries no replay buffer.

### T4 — docs + smoke (w11)
API.md sections for all four endpoints with curl examples; `smoke.sh` extended: summary check on fixture data, timeseries non-empty, feed returns `text/event-stream` + first event within timeout; README update.

## Execution

w08 ∥ w09 (disjoint files) → w10 → w11. Each worker: clone → branch off `dev`… actually branches off `main` (dev was ff-merged), PR, gate, I review/merge, ff `dev`.
