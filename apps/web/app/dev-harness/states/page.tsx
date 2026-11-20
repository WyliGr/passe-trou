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
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import { ApiError } from "@/lib/api";
import { fmtCost, fmtInt } from "@/lib/format";
import type { Account, AdminModel, MemberWithKeys, Price, Provider } from "@/lib/admin";
import { KeyTokenBlock, MembersTable, ModelChecklist } from "@/app/(console)/members/ui";
import { PricingTable } from "@/app/(console)/pricing/ui";

const now = Date.now();
const SERIES: LinePoint[] = [
  0, 0, 2, 1, 0, 4, 9, 14, 11, 18, 26, 31, 22, 25, 19, 30, 27, 16, 8, 5, 3, 1, 0, 0,
].map((value, i, arr) => ({ ts: now - (arr.length - 1 - i) * 3600_000, value }));

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

      <Block title="Members — table with expand, keys and allowlists (fixtures)">
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
      </Block>

      <Block title="Members — model checklist, key shown once, empty">
        <ModelChecklist models={MODELS_FIXTURE} selected={checklistSel} onChange={setChecklistSel} />
        <KeyTokenBlock token="pt_00000000000000000000000000000000" />
        <Empty sentence="No members yet — members hold the API keys people call the proxy with." />
      </Block>

      <Block title="Pricing — scoped rules table (fixtures)">
        <PricingTable
          prices={PRICES_FIXTURE}
          providers={PROVIDERS_FIXTURE}
          accounts={ACCOUNTS_FIXTURE}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />
        <p className="text-body text-muted">Unpriced: claude-pool · embed-small</p>
        <Empty sentence="No price rules yet — requests are metered, but cost stays unknown until a model has a price." />
      </Block>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer">
        <p className="text-body text-muted">
          Detail content for the selected object goes here — Esc or the X closes.
        </p>
      </Drawer>
    </div>
  );
}
