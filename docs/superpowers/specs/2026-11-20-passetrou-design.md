# passe•trou — Design Document

Name: **passe•trou** — always lowercase, middle dot U+00B7 (approved by Will 2026-11-20). Slug for repo/packages/files where `•` is illegal: `passe-trou`.
Repo: https://github.com/WyliGr/passe-trou (public, MIT).
Written 2026-11-20 by Will & Heermes via superpowers:brainstorming + builder-check. Rev 1.1 incorporates Will's second-round decisions.

## Intent & why

Will juggles several CommandCode accounts and one Mistral account. Every tool (Hermes gateways, OpenCode workers, misc scripts) needs its own endpoint/key config — he is done switching endpoints thirty times. He saw Theo (t3.gg)'s CLIProxyAPI setup and wants the same one-hub idea, but **built himself, open-source, and with far deeper observability** than CLIProxyAPI or LiteLLM: per-request telemetry (timings, tokens incl. reasoning/cache, tool calls, reasoning effort), a load balancer that spreads a logical model across X subscriptions, and spend tracking from hand-set prices.

passe•trou is a **self-hosted LLM gateway that load-balances logical models across pooled upstream accounts, with a first-class observability plane**. Not a dashboard bolted on a proxy — capture is part of the request path.

Position: open-source (MIT), opinionated for Will's homelab, self-hostable by others. Showcase-quality, in the spirit of Klui/Albac.

## Mindset (the T3 Code spirit)

- **Agent-first**: everything the dashboard can do is a first-class admin REST API. The dashboard is just a client of that API. Will's agents (Heermes & co.) should be able to operate passe•trou end-to-end — add an account, create a key, query spend — without a human in the UI.
- **Compute it ourselves**: ~90% of the analytics are derived from passe•trou's own metering of the traffic it proxies. Provider-side data is opportunistic enrichment, never a dependency.
- **Premium, commercial-grade feel**: the software should look and behave like a paid product. Polish beats feature count. Lean over loud (Will's Trello lesson: bloated UI kills adoption).

## Goals (v1)

- **One LAN endpoint for everything**: all of Will's and his close ones' LLM traffic flows through passe•trou. Clients configure one base URL + one key, forever.
- **Load balancer over logical models**: the admin defines **models** (virtual names, e.g. `fast-flash`) and maps each to **provider models** on specific accounts (e.g. `deepseek/deepseek-v4.1-flash` on CommandCode account A and B, `glm-x` on the Mistral account). One requested model load-balances across all its mapped accounts.
- **Subscriptions on the go**: add/remove/bench an upstream account anytime from the dashboard/API — no restart, no config-file dance. v1 auth = API keys only; **OAuth-connected providers come later** (native connector or CLIProxyAPI-as-upstream).
- **Per-key model allowlist**: each API key exposes a chosen subset of the defined models. Request outside the allowlist → clear 403.
- **Deep capture (metrics)**: every request recorded with timestamps, TTFT, total duration, tokens/sec, token counts (prompt/completion/reasoning/cached, both wire shapes), reasoning effort requested, tool calls (names, args sizes), model requested/mapped/served, account that served it, status, error class.
- **Analytics, crossable**: per **provider**, per **subscription** (account), per **model**, per **API key**, per **member** (person), and **total**. Live request feed with drill-down ("tour de contrôle").
- **Spend tracking**: admin enters prices per model and provider by hand; every request gets a computed cost when a price exists; spend dashboards per all the axes above.
- **Klui-style management**: one admin. Admin creates **members** (people) and **assigns API keys to members**, like assigning cards in Klui. Members never log in.

## Non-goals (v1)

- **Full prompt/response retention — ON STANDBY** (Will's call 2026-11-20): v1 captures metrics/metadata only, **no request or response bodies are persisted**. The project must not orbit around retention for now. Re-entry: a `RequestPayload` store + per-key data policies (`full`/`metadata`/`none`) are designed-for but deferred (see Retention section).
- **OAuth subscription flows** (Claude Pro / ChatGPT Plus device-login à la CLIProxyAPI): later. Either a native passe•trou connector, or a CLIProxyAPI instance placed *behind* passe•trou as an ordinary upstream.
- **HTTPS / public exposure**: LAN only. No TLS, no tunnel, no auth-proxy story in v1.
- Hard budget enforcement, billing, public multi-tenant service, local inference management.

## Anti-goals

- A config-only tool with no soul (LiteLLM exists; the point is the load balancer + observability).
- Storing other people's prompt content. (Retired by construction in v1: bodies are never written.)
- Dashboard bloat.

## Actors & data model

- **Admin** — exactly one login, Will (session cookie; LAN trust, still a real login).
- **Member** — a person (Will, Chloé, Léo). Attribution only; no login.
- **ApiKey** — `pt-...` bearer given to a client/agent (labels like `heermes`, `vox`, `orion`, `opencode-worker-3`). Belongs to one member. Fields: label, member, enabled, **model allowlist** (subset of Models; empty = all), created/last-used. Hashed at rest (SHA-256), shown once at creation.
- **Provider** — an upstream service (CommandCode, Mistral). Base URL + wire format(s).
- **Account** — one upstream subscription/key. Secret encrypted at rest (AES-256-GCM, key from env). Fields: label, provider, enabled (bench without restart), created. Hot-add/remove at runtime.
- **Model** — a logical model clients request. Fields: name, display name, enabled.
- **ModelMapping** — Model × Account + **upstream model name** (may differ from the logical name) + enabled. The serving pool of a Model = enabled mappings whose account is enabled and healthy.
- **PriceEntry** — Provider (+ optional Account) × upstream model name → USD per 1M input tokens / 1M output tokens (+ optional cache read/write rates). Editable in the dashboard; versioned by `editedAt` so historical costs stay honest (cost = price at request time; stretch: keep history).
- **Request** — one proxied call: apiKey→member, model requested, mapping used, account/provider that served, upstream model name, all timing/token/tool metrics, computed `costUsd` when a PriceEntry matches, status, error class. **No bodies.**
- **Rollups** — per-minute and per-hour buckets per (member / key / account / provider / model) for fast dashboards; forever-retained.

## Architecture

Single repo, single deployable unit, three internal layers:

1. **Proxy edge (Hono, Node.js 22+, TypeScript)** — OpenAI `POST /v1/chat/completions` + `GET /v1/models` (+`/v1/embeddings`), **and** Anthropic `POST /v1/messages` (required in v1: CommandCode serves Claude models only via the Anthropic shape). Streams SSE upstream→client passthrough while teeing chunks into the capture pipeline. Codex `/v1/responses` is v0.2.
   - **Passthrough only — no wire translation in v1** (approved 2026-11-20). A chat/completions request for a mapping whose upstream is Anthropic-only (all `claude-*` at CommandCode) gets a clear 400 pointing at `/v1/messages`. All of Will's agents already speak both shapes.
2. **Capture pipeline** — assembles SSE chunks per wire format (OpenAI deltas incl. `reasoning_content` + `tool_calls` fragments; Anthropic `content_block` events incl. `thinking` + `tool_use`), merges terminal usage, computes timings, enriches with cost, persists `Request` after the response finishes. **Persistence never blocks the client stream.**
3. **Dashboard (Next.js)** — admin UI over the admin REST API. See UI direction.

**Data:** Postgres 16 + Prisma.

## Load balancing & routing (v1)

- **Authored, not derived** (Will's call 2026-11-20, superseding the earlier derived-routing decision): admin creates Models, creates Accounts, and creates ModelMappings between them with the upstream model name. One logical model can span providers with different upstream names.
- **Selection**: least-used-in-window among healthy enabled mappings. Cooldown on 429 (honor `Retry-After`, else exponential from 30 s, cap 30 min) or repeated 5xx.
- **Failover**: silent retry on the next mapping only before the first token byte; mid-stream upstream death surfaces the error.
- **Per-key allowlist** filters which models a key may request; `GET /v1/models` returns only what the key can see.
- Weights/priorities and soonest-reset-first: v0.2 (reset windows aren't exposed upstream anyway).

## Analytics & spend

- Everything computed from passe•trou's own metering — provider truth is bonus, not foundation.
- Axes: **provider, subscription (account), model, API key, member, total**, over time ranges.
- Per-account views surface: tokens/requests per window, traffic share, cost, error & 429 rate, cooldown history. **"Quota remaining" is not provider-available** (see recon) — passe•trou shows usage-based projections instead.
- Live feed: requests landing in real time (SSE), one-line summaries, drill-down to the full metric set.

## Retention (standby)

v1 persists **metrics only** — no prompts, no responses, no thinking text, no tool-arg bodies. This keeps the build focused and sidesteps the third-party-prompt privacy question entirely (Chloé's and Léo's traffic leaves no content behind). The `RequestPayload` store and the per-key data policy (`full`/`metadata`/`none`, chosen at key creation) are documented-but-deferred: when retention comes back, the per-key policy gate comes back with it. Purge jobs ship anyway for metrics (configurable TTL, default: keep rollups forever, raw rows 90 days).

## Network & deployment (v1)

- LAN only: the app binds the LAN interface, plain HTTP. No HTTPS, no Pangolin/Tailscale exposure, no docs implying otherwise. Exposure is a deliberate later operator move.
- Deploy: single `docker-compose.yml` (app + Postgres). Will's instance targets **LXC 156** on toast — this supersedes the stalled LiteLLM plan for that host.

## UI direction

**Modern dark, premium, commercial-grade** — the thing should look sold, not homemade. Functional inspiration from Theo's CLIProxyAPI management UI ("prox"), elevated:

- Left icon sidebar nav; top filter chips per provider with brand-colored icons and counts; time-window chips (1h/3h/6h/custom).
- **Account/subscription panels** à la Quota Management: big pooled stat ("555% of 600%"-style), stat row (pool empty, first empty, burn rate last 3h), and recorded-vs-projected charts (solid recorded, dashed projection, reset-step annotations). Since provider quotas aren't exposed (recon), the panels run on passe•trou metering: usage bars vs admin-entered budgets, burn-rate projection.
- Live feed page as the landing "tour de contrôle".
- Muted near-black palette, one accent per provider, thin elegant chart lines; motion minimal and purposeful.

## Security

- Admin session login (password or passkey — builder's pick); API keys SHA-256 hashed, shown once.
- Upstream secrets AES-256-GCM at rest; never returned by API after creation (masked `••••last4`).
- No bodies in logs (v1 stores none anyway); metrics rows contain no content, only sizes/hashes where useful.
- LAN trust is assumed but not relied on: all admin endpoints authed, keys scoped by allowlist, proxy rejects unknown keys with 401.

## Recon findings (2026-11-20, probed against CommandCode with Will's key)

- Base: `https://api.commandcode.ai/provider/v1`. Two wire formats on the same base+key:
  - OpenAI `/chat/completions` for open models (105 models listed, public `/models`): deepseek, glm, gpt-*, kimi, minimax… Usage chunk includes `completion_tokens_details.reasoning_tokens` and `prompt_tokens_details.cached_tokens`; `reasoning_content` streams as deltas; tool calls stream as incremental deltas.
  - **Anthropic `/messages` mandatory for Claude models** (chat/completions → 400 `unsupported_model`). Usage includes `cache_creation_input_tokens`, `cache_read_input_tokens` (+5m/1h windows), `output_tokens_details.thinking_tokens`, `service_tier`, `inference_geo`. A non-standard `diagnostics` field exists (unexplored).
- **No account/quota/balance endpoints** (`/user`, `/me`, `/account`, `/balance`, `/credits`, `/usage`, `/subscription`, `/billing` all 404) and **no rate-limit headers**. ⇒ per-subscription views = passe•trou metering + observed 429 events, never provider truth.
- Cloudflare edge: default library UAs (e.g. `python-urllib`) get 403. ⇒ passe•trou sends a configurable UA upstream (default `passe-trou/x.y`).

## MVP cut (v0.1)

- Proxy: OpenAI chat/completions + models; Anthropic messages. Streaming passthrough both.
- Load balancer: Models / Accounts / ModelMappings CRUD (dashboard + API), least-used + cooldown failover, per-key model allowlist, hot-add accounts with a "test connection" action (upstream `/models` probe).
- Capture: full metric set, metrics-only (retention standby).
- Pricing: PriceEntry CRUD in dashboard, `costUsd` on every Request, spend dashboards.
- Dashboard: admin login, members/keys CRUD, live feed, request detail, account panels with usage+projection charts, analytics pages per axis + total.
- Deploy: `docker-compose.yml`, LAN bind, documented for LXC 156.

**v0.2+ backlog**: payload retention + per-key data policies, OAuth providers (native or CLIProxyAPI-behind), Codex `/v1/responses`, routing strategies (weights, soonest-reset-first), budget alerts, Ollama provider, Prometheus/OTel export, wire translation, CommandCode quota scraping if an undocumented API exists.

## Open questions for Will

1. Does CommandCode's web dashboard show quota/reset info (and is there an undocumented JSON API behind it)? Determines whether true per-account quota panels can ever exist.

Everything not specified here (exact metric names, pagination, chart lib, port numbers, color values) is left to the builder.
