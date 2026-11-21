"use client";

// DEV-ONLY fixture harness: renders every base component's states (loading / error / empty / data).
// Kept OUT of navigation on purpose; served at /__dev__/states via middleware rewrite
// (leading-underscore folders are private to the App Router).

import { useState } from "react";
import { BarList } from "@/components/BarList";
import { Drawer } from "@/components/Drawer";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { KpiStrip } from "@/components/KpiStrip";
import { LineChart, type LinePoint } from "@/components/LineChart";
import { PageTitle } from "@/components/PageTitle";
import { Pill } from "@/components/Pill";
import { RangeTabs } from "@/components/RangeTabs";
import { RequestDrawer } from "@/components/RequestDrawer";
import { RequestLane, type LaneEvent } from "@/components/RequestLane";
import { requestColumns } from "@/components/requestColumns";
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import { ApiError } from "@/lib/api";
import { fmtCost, fmtInt } from "@/lib/format";
import type { RankedRow } from "@/lib/analytics";
import type { RequestRow } from "@/lib/requests";
import { ConfirmDrawer } from "@/components/ConfirmDrawer";
import { CreateButton } from "@/components/CreateButton";
import { StatusCellDot } from "@/components/StatusDot";
import { Field, SecretInput, SelectInput, TextInput } from "@/components/fields";
import type { Account, AdminModel, MemberWithKeys, Price, Provider } from "@/lib/admin";
import { KeyTokenBlock, MembersTable, ModelChecklist } from "@/app/(console)/members/ui";
import { PricingTable } from "@/app/(console)/pricing/ui";

const now = Date.now();
const SERIES: LinePoint[] = [
  0, 0, 2, 1, 0, 4, 9, 14, 11, 18, 26, 31, 22, 25, 19, 30, 27, 16, 8, 5, 3, 1, 0, 0,
].map((value, i, arr) => ({ ts: now - (arr.length - 1 - i) * 3600_000, value }));

// W14 — analytics bar-list fixture: 11 groups so the list caps at 8 rows + a "+3 more" line.
const BAR_ROWS: RankedRow[] = [
  { id: "cc", name: "CommandCode", value: 4.2311, share: 0.78 },
  { id: "mistral", name: "Mistral", value: 0.4812, share: 0.09 },
  { id: "groq", name: "Groq", value: 0.3222, share: 0.06 },
  { id: "cf", name: "Cloudflare workers", value: 0.1611, share: 0.03 },
  { id: "dn", name: "Deep network", value: 0.1071, share: 0.02 },
  { id: "loc", name: "Local vLLM", value: 0.059, share: 0.01 },
  { id: "bk", name: "Backup upstream", value: 0.0214, share: 0.004 },
  { id: "exp", name: "Experiments", value: 0.008, share: 0.0015 },
  { id: "old1", name: "Legacy one", value: 0.0012, share: 0.0002 },
  { id: "old2", name: "Legacy two", value: 0.0008, share: 0.0001 },
  { id: "old3", name: "Legacy three", value: 0.0004, share: 0.0001 },
];

// Latency fixture: avg with one honest null gap + p95 above it.
const LAT_VALUES: { avg: number | null; p95: number | null }[] = [
  { avg: 320, p95: 910 }, { avg: 305, p95: 880 }, { avg: 410, p95: 1240 },
  { avg: 388, p95: 1105 }, { avg: null, p95: null }, { avg: 342, p95: 960 },
  { avg: 356, p95: 990 }, { avg: 421, p95: 1310 }, { avg: 399, p95: 1180 },
  { avg: 365, p95: 1020 }, { avg: 372, p95: 1044 }, { avg: 341, p95: 950 },
];
const LAT_PRIMARY: LinePoint[] = LAT_VALUES.map((p, i, arr) => ({
  ts: now - (arr.length - 1 - i) * 3600_000,
  value: p.avg,
}));
const LAT_SECONDARY: LinePoint[] = LAT_VALUES.map((p, i, arr) => ({
  ts: now - (arr.length - 1 - i) * 3600_000,
  value: p.p95,
}));

// Lane fixture: ~40 requests over the last 60 minutes, error + aborted present.
const LANE_EVENTS: LaneEvent[] = Array.from({ length: 42 }, (_, i) => {
  const statuses: LaneEvent["status"][] = ["ok", "ok", "ok", "ok", "ok", "ok", "error", "aborted"];
  return {
    id: `lane-${i}`,
    ts: now - Math.floor((i / 42) * 58 * 60 * 1000) - (i % 3) * 12_000,
    status: statuses[Math.floor(i * 2.7) % statuses.length]!,
    fresh: i === 0 || i === 1,
  };
});

const FIXTURE_REQUESTS: RequestRow[] = [
  {
    id: "req_9f4c2ab8e17d4031", ts: new Date(now - 12_000).toISOString(),
    requestedModel: "claude-sonnet-4", upstreamModel: "claude-sonnet-4-20250514",
    wireFormat: "anthropic", stream: true, status: "ok", httpStatus: 200, errorCode: null,
    latencyMs: 2410, ttftMs: 318, promptTokens: 1821, completionTokens: 402,
    reasoningTokens: 120, cachedTokens: 512, toolCallCount: 0, finishReason: "stop",
    costUsd: 0.0142, clientName: "cursor",
    key: { id: "key1", label: "laptop", prefix: "pt_9f4c2ab8" },
    member: { id: "m1", name: "Chloé" },
    account: { id: "a1", displayName: "compte-1", provider: "CommandCode" },
    model: { id: "mod1", name: "claude-sonnet-4" },
  },
  {
    id: "req_2bb7d04f91a64c88", ts: new Date(now - 41_000).toISOString(),
    requestedModel: "gpt-5.2", upstreamModel: "gpt-5.2-2025-11-01",
    wireFormat: "openai", stream: false, status: "error", httpStatus: 429, errorCode: "rate_limited",
    latencyMs: 812, ttftMs: null, promptTokens: 640, completionTokens: 0,
    reasoningTokens: null, cachedTokens: null, toolCallCount: null, finishReason: null,
    costUsd: 0, clientName: "cli-script",
    key: { id: "key2", label: "ci", prefix: "pt_2bb7d04f" },
    member: { id: "m2", name: "Raf" },
    account: { id: "a2", displayName: "compte-2", provider: "CommandCode" },
    model: { id: "mod2", name: "gpt-5.2" },
  },
  {
    id: "req_77e1c90ad2f44e02", ts: new Date(now - 3 * 60_000).toISOString(),
    requestedModel: "mistral-large", upstreamModel: "mistral-large-2411",
    wireFormat: "openai", stream: true, status: "aborted", httpStatus: 499, errorCode: "client_aborted",
    latencyMs: 9044, ttftMs: 1205, promptTokens: 2310, completionTokens: 89,
    reasoningTokens: 0, cachedTokens: 0, toolCallCount: 2, finishReason: null,
    costUsd: 0.0031, clientName: null,
    key: { id: "key1", label: "laptop", prefix: "pt_9f4c2ab8" },
    member: { id: "m1", name: "Chloé" },
    account: { id: "a3", displayName: "mistral-1", provider: "Mistral" },
    model: { id: "mod3", name: "mistral-large" },
  },
];

type Row = { account: string; provider: string; status: React.ReactNode; req: number; cost: number };
const ROWS: Row[] = [
  { account: "compte-1", provider: "CommandCode", status: <StatusCellDot tone="success" label="active" />, req: 96, cost: 0.8123 },
  { account: "compte-2", provider: "CommandCode", status: <StatusCellDot tone="warning" label="cooling down" />, req: 41, cost: 0.4191 },
  { account: "mistral-1", provider: "Mistral", status: <StatusCellDot tone="error" label="down" />, req: 0, cost: 0 },
];

const COLUMNS: Column<Row>[] = [
  { key: "account", header: "Account" },
  { key: "provider", header: "Provider", render: (r) => <span className="text-secondary">{r.provider}</span> },
  { key: "status", header: "Status" },
  { key: "req", header: "Requests", align: "right", render: (r) => fmtInt(r.req) },
  { key: "cost", header: "Cost", align: "right", render: (r) => <span className="text-secondary">{fmtCost(r.cost)}</span> },
];

// --- W16 fixtures: /members and /pricing screens ---
const MODELS_FIXTURE: AdminModel[] = [
  { id: "m1", displayName: "fast-flash", enabled: true, createdAt: "", updatedAt: "", mappings: [] },
  { id: "m2", displayName: "claude-pool", enabled: true, createdAt: "", updatedAt: "", mappings: [] },
  { id: "m3", displayName: "embed-small", enabled: false, createdAt: "", updatedAt: "", mappings: [] },
];
const MEMBERS_FIXTURE: MemberWithKeys[] = [
  {
    id: "mb1", displayName: "Will", enabled: true, createdAt: "2026-11-02T09:12:00.000Z", updatedAt: "",
    keys: [
      { id: "k1", keyPrefix: "pt_a3f9c2e1", label: "opencode-worker-3", enabled: true, createdAt: "2026-11-02T09:13:00.000Z", allowlist: [{ id: "m1", displayName: "fast-flash" }] },
      { id: "k2", keyPrefix: "pt_7bd4109f", label: "laptop-cli", enabled: true, createdAt: "2026-11-10T18:44:00.000Z", allowlist: [] },
    ],
  },
  {
    id: "mb2", displayName: "Nia", enabled: true, createdAt: "2026-11-12T08:02:00.000Z", updatedAt: "",
    keys: [
      { id: "k3", keyPrefix: "pt_e55b02c8", label: "smoke-agent", enabled: false, createdAt: "2026-11-12T08:03:00.000Z", allowlist: [{ id: "m2", displayName: "claude-pool" }] },
    ],
  },
  { id: "mb3", displayName: "Raf", enabled: true, createdAt: "2026-11-18T15:31:00.000Z", updatedAt: "", keys: [] },
];
const PROVIDERS_FIXTURE: Provider[] = [
  { id: "p1", displayName: "CommandCode", type: "openai-compatible", baseUrl: "", createdAt: "", updatedAt: "" },
];
const ACCOUNTS_FIXTURE: Array<Account & { providerName: string }> = [
  { id: "a1", providerId: "p1", displayName: "compte-1", status: "active", keyPrefix: "sk-…", createdAt: "", updatedAt: "", providerName: "CommandCode" },
];
const PRICES_FIXTURE: Price[] = [
  { id: "pr1", scope: "provider", providerId: "p1", accountId: null, modelMatcher: "deepseek/*", priceInput: 0.14, priceOutput: 0.28, priceCachedInput: null, updatedAt: "" },
  { id: "pr2", scope: "account", providerId: null, accountId: "a1", modelMatcher: "deepseek/deepseek-v4.1-flash", priceInput: 0.1, priceOutput: 0.2, priceCachedInput: 0.05, updatedAt: "" },
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-surface p-6 flex flex-col gap-4">
      <h2 className="h2">{title}</h2>
      {children}
    </section>
  );
}

export default function DevStatesPage() {
  const [range, setRange] = useState<string>("24h");
  const [kpi, setKpi] = useState("requests");
  const [drawer, setDrawer] = useState(false);
  const [reqDrawerRow, setReqDrawerRow] = useState<RequestRow | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [field, setField] = useState("fast-flash");
  const [select, setSelect] = useState("openai-compatible");
  const [secret, setSecret] = useState("");
  const [memberExpanded, setMemberExpanded] = useState<Set<string>>(new Set(["mb1"]));
  const [checklistSel, setChecklistSel] = useState<Set<string>>(new Set(["m1"]));

  return (
    <div className="ml-14 p-[var(--pad)] flex flex-col max-md:ml-0" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Component states"
        finding="Dev-only harness — fixtures, not live data."
        actions={
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="h-[var(--control-height)] rounded-md bg-muted px-4 text-sm text-foreground hover:bg-border"
          >
            Open drawer
          </button>
        }
      />

      <Block title="KpiStrip — selected cell carries the muted fill">
        <KpiStrip
          items={[
            { id: "requests", label: "Requests", value: fmtInt(137) },
            { id: "tokensIn", label: "Tokens in", value: fmtInt(4102310) },
            { id: "tokensOut", label: "Tokens out", value: fmtInt(88211) },
            { id: "spend", label: "Spend", value: fmtCost(1.2314) },
            { id: "accounts", label: "Active accounts", value: fmtInt(2) },
          ]}
          selectedId={kpi}
          onSelect={setKpi}
        />
      </Block>

      <Block title="RangeTabs">
        <RangeTabs
          options={[
            { id: "24h", label: "24h" },
            { id: "7j", label: "7j" },
            { id: "30j", label: "30j" },
          ]}
          value={range}
          onChange={setRange}
        />
      </Block>

      <Block title="LineChart — series, hover for crosshair">
        <LineChart points={SERIES} formatValue={(v) => fmtInt(v)} ariaLabel="Requests per hour, last 24 hours" />
      </Block>

      <Block title="LineChart — latency: avg + p95 at 35%, null gap, legend chips">
        <LineChart
          points={LAT_PRIMARY}
          secondary={LAT_SECONDARY}
          legend={{ primary: "avg", secondary: "p95" }}
          formatValue={(v) => `${Math.round(v)} ms`}
          ariaLabel="Latency per hour"
        />
      </Block>

      <Block title="LineChart — avg + p95 overlay (analytics latency tab, W14)">
        <LineChart
          points={SERIES.map((p) => ({ ts: p.ts, value: 420 + (p.value ?? 0) * 12 }))}
          overlay={{ points: SERIES.map((p) => ({ ts: p.ts, value: 900 + (p.value ?? 0) * 41 })), label: "P95" }}
          label="Avg"
          formatValue={(v) => `${fmtInt(v)} ms`}
          ariaLabel="Avg and p95 latency per hour"
        />
      </Block>

      <Block title="Bar list — 8 rows + “+3 more” (analytics by-group panel, W14)">
        <BarList rows={BAR_ROWS} formatValue={fmtCost} />
      </Block>

      <Block title="Analytics panel — empty (W14)">
        <Empty sentence="No data in this window." />
      </Block>

      <Block title="Analytics panel — error, verbatim + retry (W14)">
        <ErrorBlock
          error={new ApiError("invalid_request", "window too large: > 10000 buckets", 400)}
          onRetry={() => undefined}
        />
      </Block>

      <Block title="LineChart — single point">
        <LineChart points={[{ ts: now - 3600_000, value: 3 }]} formatValue={(v) => fmtInt(v)} />
      </Block>

      <Block title="RequestLane — live (fixture events, click goes to /requests)">
        <RequestLane fixtures={{ events: LANE_EVENTS, feedState: "live" }} />
      </Block>

      <Block title="RequestLane — reconnecting / empty">
        <RequestLane fixtures={{ events: LANE_EVENTS, feedState: "reconnecting" }} />
        <RequestLane fixtures={{ events: [], feedState: "live" }} />
      </Block>

      <Block title="Request table — ok muted / error badge / aborted badge; click a row for the drawer">
        <div className="overflow-x-auto">
          <Table
            columns={requestColumns({ account: true, wire: true, tokens: true, now })}
            rows={FIXTURE_REQUESTS}
            rowKey={(r) => r.id}
            onRowClick={setReqDrawerRow}
            rowClassName={(r) => (r.id === FIXTURE_REQUESTS[0]!.id ? "row-in" : "")}
          />
        </div>
        <Empty sentence="No requests match — widen the filters or send traffic to the proxy." />
        <ErrorBlock error={new ApiError("invalid_cursor", "cursor is not valid base64url JSON", 400)} onRetry={() => undefined} />
        <SkeletonRows rows={3} rowHeight="42px" />
      </Block>

      <Block title="Table">
        <div className="overflow-x-auto">
          <Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.account} />
        </div>
      </Block>

      <Block title="Badges — the only place semantic colours appear">
        <div className="flex gap-3">
          <Pill variant="neutral">active</Pill>
          <Pill variant="success">reachable</Pill>
          <Pill variant="warning">benched</Pill>
          <Pill variant="error">pool_exhausted</Pill>
          <Pill variant="info">cooldown_429</Pill>
        </div>
      </Block>

      <Block title="Empty">
        <Empty sentence="No requests yet — create a member key and call /v1/chat/completions." />
      </Block>

      <Block title="Error — API message verbatim + retry">
        <ErrorBlock error={new ApiError("pool_exhausted", "all accounts cooling", 503)} onRetry={() => undefined} />
      </Block>

      <Block title="Loading">
        <SkeletonRows rows={3} />
        <Skeleton className="h-[200px] w-full" />
      </Block>

      <Block title="Create control — the one primary button (DESIGN.md)">
        <div>
          <CreateButton label="New provider" onClick={() => undefined} />
        </div>
      </Block>

      <Block title="Form fields — label above, API error verbatim under the field (W15)">
        <div className="max-w-sm flex flex-col gap-4">
          <Field label="Name" hint={'Callable as /v1/chat/completions model:"<name>"'}>
            <TextInput value={field} onChange={setField} />
          </Field>
          <Field label="Display name" error="displayName already exists">
            <TextInput value="CommandCode" onChange={() => undefined} />
          </Field>
          <Field label="Type">
            <SelectInput
              value={select}
              onChange={setSelect}
              options={[
                { id: "openai-compatible", label: "OpenAI-compatible" },
                { id: "anthropic-compatible", label: "Anthropic-compatible" },
              ]}
            />
          </Field>
          <Field label="Upstream API key" hint="Stored encrypted; only the key prefix is kept for display.">
            <SecretInput value={secret} onChange={setSecret} placeholder="sk-…" />
          </Field>
        </div>
      </Block>

      <Block title="Providers — inline connection-test result, signs not colours (W15)">
        <div className="flex gap-6 font-mono text-body">
          <span className="text-success">+ 214 ms</span>
          <span className="text-error">– HTTP 401</span>
          <span className="text-secondary">testing…</span>
          <span className="font-sans text-warning">no credential</span>
        </div>
      </Block>

      <Block title="Models — expanded mappings fixture (W15)">
        <div className="pl-6">
          <div className="flex h-9 items-center gap-3">
            <span className="min-w-0 flex-1 text-body">
              <span className="text-foreground">compte-1</span>
              <span className="text-secondary"> · CommandCode</span>
            </span>
            <span className="font-mono text-body text-secondary">deepseek/deepseek-v4.1-flash</span>
            <span className="w-14 text-right text-error">Delete</span>
          </div>
          <div className="flex h-9 items-center gap-3 border-t border-border">
            <span className="min-w-0 flex-1 text-body">
              <span className="text-foreground">mistral-1</span>
              <span className="text-secondary"> · Mistral</span>
            </span>
            <Pill variant="warning">benched</Pill>
            <span className="font-mono text-body text-secondary">mistral-small-latest</span>
            <span className="w-14" />
          </div>
          <div className="mt-1 border-t border-border pt-2">
            <button
              type="button"
              className="h-[28px] rounded-md bg-muted px-3 text-small text-foreground hover:bg-border"
            >
              Map account…
            </button>
          </div>
        </div>
      </Block>

      <Block title="Confirm drawer — typed confirm + API 409 verbatim (W15)">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="h-[var(--control-height)] rounded-md bg-error-surface px-4 text-sm text-error hover:brightness-125"
          >
            Delete account
          </button>
          <span className="text-body text-secondary">
            Esc/backdrop cancels; the confirm needs the typed account name.
          </span>
        </div>
      </Block>

      <Block title="Members — table with expand, keys and allowlists (W16 fixtures)">
        <div className="overflow-x-auto">
          <MembersTable
            members={MEMBERS_FIXTURE}
            expanded={memberExpanded}
            onToggle={(id) =>
              setMemberExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onEditAllowlist={() => undefined}
            onDeleteKey={() => undefined}
          />
        </div>
      </Block>

      <Block title="Members — model checklist, key shown once, empty (W16)">
        <ModelChecklist models={MODELS_FIXTURE} selected={checklistSel} onChange={setChecklistSel} />
        <KeyTokenBlock token="pt_00000000000000000000000000000000" />
        <Empty sentence="No members yet — members hold the API keys people call the proxy with." />
      </Block>

      <Block title="Pricing — scoped rules table (W16 fixtures)">
        <div className="overflow-x-auto">
          <PricingTable
            prices={PRICES_FIXTURE}
            providers={PROVIDERS_FIXTURE}
            accounts={ACCOUNTS_FIXTURE}
            onEdit={() => undefined}
            onDelete={() => undefined}
          />
        </div>
        <p className="text-body text-secondary">Unpriced: claude-pool · embed-small</p>
        <Empty sentence="No price rules yet — requests are metered, but cost stays unknown until a model has a price." />
      </Block>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer">
        <p className="text-body text-secondary">
          Detail content for the selected object goes here — Esc or the X closes.
        </p>
      </Drawer>

      <ConfirmDrawer
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete compte-1"
        consequence="The account leaves every serving pool; the API answers 409 while model mappings still reference it."
        confirmLabel="Delete account"
        typedName="compte-1"
        error={new ApiError("account_has_mappings", "account is referenced by 2 model mappings", 409)}
        onConfirm={async () => {
          throw new ApiError("account_has_mappings", "account is referenced by 2 model mappings", 409);
        }}
      />
    </div>
  );
}
