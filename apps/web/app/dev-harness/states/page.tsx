"use client";

// DEV-ONLY fixture harness: renders every base component's states (loading / error / empty / data).
// Kept OUT of navigation on purpose; served at /__dev__/states via middleware rewrite
// (leading-underscore folders are private to the App Router).

import { useState } from "react";
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
import type { RequestRow } from "@/lib/requests";

const now = Date.now();
const SERIES: LinePoint[] = [
  0, 0, 2, 1, 0, 4, 9, 14, 11, 18, 26, 31, 22, 25, 19, 30, 27, 16, 8, 5, 3, 1, 0, 0,
].map((value, i, arr) => ({ ts: now - (arr.length - 1 - i) * 3600_000, value }));

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
  { account: "compte-1", provider: "CommandCode", status: <Pill variant="neutral">active</Pill>, req: 96, cost: 0.8123 },
  { account: "compte-2", provider: "CommandCode", status: <Pill variant="warning">cooling down</Pill>, req: 41, cost: 0.4191 },
  { account: "mistral-1", provider: "Mistral", status: <Pill variant="warning">benched</Pill>, req: 0, cost: 0 },
];

const COLUMNS: Column<Row>[] = [
  { key: "account", header: "Account" },
  { key: "provider", header: "Provider", render: (r) => <span className="text-muted">{r.provider}</span> },
  { key: "status", header: "Status" },
  { key: "req", header: "Requests", align: "right", render: (r) => fmtInt(r.req) },
  { key: "cost", header: "Cost", align: "right", render: (r) => <span className="text-muted">{fmtCost(r.cost)}</span> },
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-6 flex flex-col gap-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DevStatesPage() {
  const [range, setRange] = useState<string>("24h");
  const [kpi, setKpi] = useState("requests");
  const [drawer, setDrawer] = useState(false);
  const [reqDrawerRow, setReqDrawerRow] = useState<RequestRow | null>(null);

  return (
    <div className="ml-14 p-[var(--pad)] flex flex-col max-md:ml-0" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Component states"
        finding="Dev-only harness — fixtures, not live data."
        actions={
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="h-[var(--control-height)] rounded-control border border-control px-4 text-sm text-text hover:border-muted"
          >
            Open drawer
          </button>
        }
      />

      <Block title="KpiStrip — selected cell carries the accent line">
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

      <Block title="Request table — ok muted / error pill / aborted pill; click a row for the drawer">
        <Table
          columns={requestColumns({ account: true, wire: true, tokens: true, now })}
          rows={FIXTURE_REQUESTS}
          rowKey={(r) => r.id}
          onRowClick={setReqDrawerRow}
          rowClassName={(r) => (r.id === FIXTURE_REQUESTS[0]!.id ? "row-in" : "")}
        />
        <Empty sentence="No requests match — widen the filters or send traffic to the proxy." />
        <ErrorBlock error={new ApiError("invalid_cursor", "cursor is not valid base64url JSON", 400)} onRetry={() => undefined} />
        <SkeletonRows rows={3} rowHeight="42px" />
      </Block>

      <Block title="Table">
        <Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.account} />
      </Block>

      <Block title="Pills">
        <div className="flex gap-3">
          <Pill variant="neutral">active</Pill>
          <Pill variant="positive">reachable</Pill>
          <Pill variant="warning">benched</Pill>
          <Pill variant="negative">pool_exhausted</Pill>
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

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer">
        <p className="text-body text-muted">
          Detail content for the selected object goes here — Esc or the X closes.
        </p>
      </Drawer>
    </div>
  );
}
