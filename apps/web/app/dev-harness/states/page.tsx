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
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import { ApiError } from "@/lib/api";
import { fmtCost, fmtInt } from "@/lib/format";
import type { RankedRow } from "@/lib/analytics";

const now = Date.now();
const SERIES: LinePoint[] = [
  0, 0, 2, 1, 0, 4, 9, 14, 11, 18, 26, 31, 22, 25, 19, 30, 27, 16, 8, 5, 3, 1, 0, 0,
].map((value, i, arr) => ({ ts: now - (arr.length - 1 - i) * 3600_000, value }));

// Analytics bar-list fixture: 11 groups so the list caps at 8 rows + a "+3 more" line.
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

      <Block title="LineChart — single point">
        <LineChart points={[{ ts: now - 3600_000, value: 3 }]} formatValue={(v) => fmtInt(v)} />
      </Block>

      <Block title="LineChart — avg + p95 overlay (analytics latency tab)">
        <LineChart
          points={SERIES.map((p) => ({ ts: p.ts, value: 420 + p.value * 12 }))}
          overlay={{ points: SERIES.map((p) => ({ ts: p.ts, value: 900 + p.value * 41 })), label: "P95" }}
          label="Avg"
          formatValue={(v) => `${fmtInt(v)} ms`}
          ariaLabel="Avg and p95 latency per hour"
        />
      </Block>

      <Block title="Bar list — 8 rows + “+3 more” (analytics by-group panel)">
        <BarList rows={BAR_ROWS} formatValue={fmtCost} />
      </Block>

      <Block title="Analytics panel — empty">
        <Empty sentence="No data in this window." />
      </Block>

      <Block title="Analytics panel — error, verbatim + retry">
        <ErrorBlock
          error={new ApiError("invalid_request", "window too large: > 10000 buckets", 400)}
          onRetry={() => undefined}
        />
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
