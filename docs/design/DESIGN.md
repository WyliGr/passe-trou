# passe•trou web console — DESIGN.md (M3, binding)

The art direction for the web console. Drawn by tasteskill v2 (`--app`, kind analytics, dark, style `data-terminal`, seed 1767273845). **Adopt it whole.** Companion reads in this folder: `direction.md` (the full dealt sheet), `app-screens.md` (the shared house rules — the numbers below come from it), `app.css` + `charts.js` (neutral reference implementations).

## The product in one line

passe•trou is a self-hosted LLM gateway: it routes OpenAI-compatible traffic across many provider subscriptions, meters every request (TTFT, tokens, cost), and lets its owner watch and steer that flow. The console is an **ops terminal read in short, frequent sessions**, not a marketing surface.

## Decisions (already taken — do not re-debate)

**The move (style `data-terminal`):** every selection (nav item, tab, toggle, range preset, KPI-selected metric) is a **1px accent line exactly as wide as its label, on the nearest existing edge**. Numbers stay white or grey and carry their sign in the text (`+$0.42`, `−12 ms`). Colour budget < 3% of pixels; the accent is never more than a line plus data marks.

**The face:**
1. **All figures in IBM Plex Mono** (400/500; prices, counts, ms, timestamps, ids truncated to 8 chars). All prose in **Public Sans** (400/500/600/700). The mono-figures decision is intentional (the sheet's sanctioned face option) — tell any linter so.
2. Accent stays the dealt blue `#4a8ad6`; it is the only selection mark, plus the main data element's hue.
3. **Brand mark:** `passe•trou` — the midpoint `•` set in the accent — at the top of the rail; a circular `•` glyph as the rail's brand icon and favicon.

**Signature element (this product only):** the **request lane** — a minute-by-minute strip of recent requests (dots or ticks per request, status-encoded: ok = grey, error = `--pill-negative-ink`, aborted = `--warning`), fed live by `GET /admin/analytics/feed` (SSE). It sits under the Overview title row and is the first thing that proves the proxy is alive. Nobody else has this strip.

**Words of the trade (use these, not template nouns):** upstream, account, subscription, benched, allowlist, circuit breaker, failover, TTFT, key prefix, spend, mapped model, member.

## Screens & their one question

| Route | Question it answers first |
| --- | --- |
| `/` (Overview) | Is traffic flowing, and what did today cost? |
| `/analytics` | Where do spend and latency come from (provider · account · model · key · member)? |
| `/requests` | Which requests just happened, and why did the slow/failed ones fail? |
| `/providers` | Which subscriptions are healthy, benched, or tripping their breaker? |
| `/models` | What does each logical model map to, and is it reachable? |
| `/members` | Who holds which keys, with what allowlist? |
| `/pricing` | What price is each model billed at, and where does a rule apply? |

Every screen shows its finding (the one fact needing attention today) as the line under its title — e.g. "2 accounts benched", "error rate 4.1% in the last hour vs 0.3% today".

## Shell — icon rail (from the sheet §4)

- Rail 56px wide, page ground, 1px `--rule` right edge. Brand `•` at top; icons 16px outline (1.5px stroke), 44px pitch; active item = 1px accent bar on the rail's inner edge + icon brightens to `var(--text)`. Tooltips on hover + accessible names. Groups: Monitor (Overview, Analytics, Requests) · Configure (Providers, Models, Members, Pricing) split by a 20px hairline; bottom: token/logout.
- No labelled sidebar, no top bar. The canvas is fluid, `--pad` 32px outer padding, `--gap` 24px between blocks.
- Page title row: 26px/600 title (sentence case) + 14px muted finding line; quiet actions at the right end (outlined, `--control-height` 34px, pill radius for controls only).
- On phone (≤768px): rail becomes a bottom bar, same icons + 10px labels under.

## Tokens

Use EXACTLY the CSS variables from `direction.md` §2 (ground `#171719`, surface `#131217`, raised `#212023`, border `#222224`, text `#fff`, muted `#8a8c92`, accent `#4a8ad6`, positive `#44a282`, negative `#e5566f`, warning `#d9a441`, chart-1 `#f2f2f3`, radii: card 6px, controls 999px, rows 42px, gap 24px, pad 32px, control height 34px, font sizes title 26 / section 20 / kpi 20 / body 13 / small 12). Everything references tokens; no ad-hoc hex in component CSS (charts may use chart-1/2/3, pills use the pill token pairs).

## Blocks (from the sheet §5, adapted to this product)

**Overview:** title row (finding + time-range preset control: 24h · 7j · 30j, selection = the 1px line). Then the **request lane** (signature element, live). Then the usage tray: `--surface` tray, 6px padding, holding a KPI strip of equal cells (14/500 muted label over a 20px/400 mono value with muted unit suffix; today's requests · tokens in/out · spend `$` · avg TTFT · avg latency · error rate) — **the selected KPI cell drives the chart below it** (selection = the 1px accent line under the cell's label; never a second control repeating the KPI names). Chart card under the KPI strip: timeseries from `/admin/analytics/timeseries` for the selected metric at the chosen range. Last block: recent requests table capped at 5 rows (49px pitch) with "View all → /requests". On a fresh install: a getting-started strip (4 equal cells divided by 1px rules: Add a provider → Add an account + key → Map a model → Create a member key) shown until each step is done (derive from `/admin/overview` data — zeros mean not done).

**Analytics:** 24/700?? No — page title 26px per tokens. Underline **tabs** on a 1px `--rule`: Spend · Latency · Tokens · Errors (selection = accent line). Group-by control as compound outlined segments reading as a sentence (`Group by · provider ▾`). KPI row = equal columns (requests · tokens · spend · avg latency · p95 · error rate), mono values, fixed decimals. Then **two equal panels** with 73px headers (14/600 title, 13px muted description, dropdown switching the panel's metric) over a full-bleed 1px rule: left = **sorted bar list** (64px row pitch; label line; 10px pill bar in `--chart-1`, no track; mono value 5px after the bar's end; longest bar ≈ 88% width) of the current group-by; right = **ranking table** (53px rows, rules inset to the padding, rank in muted mono, name, values right-aligned, the row of the busiest member/key flagged by a neutral `--raised` chip). Time-series panel below at full width when a tab is active.

**Requests:** filter row (28px outlined compound groups reading as sentences: `Status · all ▾`, `Member · all ▾`, `min latency · —`) + a **Live** toggle (accent line under its label when on; when on, new rows from the SSE feed prepend with a 150ms ease and the table keeps scroll position). Table 42-49px rows: ts (mono, relative), requested model, member · key prefix, account, status chip (ok = muted text, error = negative pill token, aborted = warning pill token), TTFT, latency, tokens in/out, cost — numbers right-aligned tabular mono. Row click → **detail drawer** right (480px, `--surface`, 1px `--rule` left edge): every field incl. upstream model, wire format, finish reason, error code, tool call count. Cursor pagination button "Load earlier" at the foot.

**Providers / Models / Members / Pricing:** list pages, 42px rows, honest states. Each row's primary action on hover; one primary creation control per page (`New provider`, `New model`…) as an **outlined** button with the accent 1px under its label (no filled accent buttons — colour budget). Create/edit in right drawers (same spec as request detail). Destructive actions ask for a typed confirm when they cascade (delete provider with accounts → blocked anyway by API 409: surface the API's error message verbatim in the drawer). Account row shows circuit state (cooldown → warning pill "cooling down"); test-connection button per account showing `{ok, latencyMs}` inline. Key creation shows the plaintext ONCE in the drawer with a copy button and the sentence "This is the only time this key is shown."

## Charts (house rules §6)

Hand-rolled SVG, no chart library. `docs/design/charts.js` is the reference (`line`, `bars`, `barList`, `timeStrip` map to: metric chart, histograms, analytics bar list, request lane). Single series = no legend; gridlines 3-5 faint lines or none; y labels right-aligned mono in `--muted`; x labels = dates/hours (never skipped into unreadability); the one data hue (`--chart-1`, or `--accent` for the selected metric) on the main element; a second series only when it answers a comparison and takes `--chart-2`/pill tokens. Tooltip = crosshair + small `--raised` card.

## States (§11) — build all four for every block

- **Zero:** print `0` honestly at value size (0 requests today is information, not an empty chart).
- **Missing:** muted dash `–` at label size.
- **Empty:** keep the block's frame; one 13px muted sentence of the trade ("No requests yet — create a member key and call /v1/chat/completions."), action link if one exists.
- **Loading:** skeleton rows at the real row height in `--raised`, never spinners alone.
- **Error:** the API's `{ error: { code, message } }` shown verbatim, retry button; 401 → bounce to `/login`.
- SSE disconnected → the Live toggle shows "reconnecting…" muted; no red banners.

## Auth & data layer

- `/login`: centered 400px column (brand `•`, "Admin token" password field, submit). Token in `localStorage` (`pt_admin_token`); every fetch sends `Authorization: Bearer`; 401 anywhere → clear + redirect login. No backend session, no cookie.
- All data from the real API (`/admin/overview`, `/admin/analytics/*`, `/admin/requests`, CRUD routes from `apps/api/API.md`). Relative fetch paths: the web app proxies `/api/*` to the API (Next `rewrites()` — `/api/:path*` → `${API_INTERNAL_URL}/:path*`); client code always fetches `/api/...`.
- Numbers format (§7.4): thousands separators, fixed decimals per metric (cost 4+, tokens 0), units as smaller muted suffixes, `font-variant-numeric: tabular-nums` everywhere a figure lives.

## Banned (inspector + review will check)

Gradients, glows, glass/backdrop-blur, shadows except the style's one card shadow, icons in tinted squares, sparklines on KPIs, rainbow charts, emoji, zebra tables, uppercase tracked labels, eyebrow labels, lorem/Acme/placeholder data, filled coloured primary buttons scattered around, "Welcome back", waving hands. Mono outside figures/ids/code. Violet/indigo anything.
