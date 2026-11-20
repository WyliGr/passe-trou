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
import { ConfirmDrawer } from "@/components/ConfirmDrawer";
import { CreateButton } from "@/components/CreateButton";
import { Field, SecretInput, SelectInput, TextInput } from "@/components/fields";
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
  const [confirm, setConfirm] = useState(false);
  const [field, setField] = useState("fast-flash");
  const [select, setSelect] = useState("openai-compatible");
  const [secret, setSecret] = useState("");

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

      <Block title="Create control — outlined, accent line under the label (W15)">
        <div>
          <CreateButton label="New provider" onClick={() => undefined} />
        </div>
      </Block>

      <Block title="Form fields — label above, API error verbatim under the field (W15)">
        <div className="max-w-sm flex flex-col gap-4">
          <Field label="Name" hint={'Callable as /v1/chat/completions model:"<name>"'}>
            <TextInput value={field} onChange={setField} />
          </Field>
          <Field
            label="Display name"
            error="displayName already exists"
          >
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
          <span className="text-positive">+ 214 ms</span>
          <span className="text-negative">– HTTP 401</span>
          <span className="text-muted">testing…</span>
          <span className="font-sans text-warning">no credential</span>
        </div>
      </Block>

      <Block title="Models — expanded mappings fixture (W15)">
        <div className="pl-6">
          <div className="flex h-9 items-center gap-3">
            <span className="min-w-0 flex-1 text-body">
              <span className="text-text">compte-1</span>
              <span className="text-muted"> · CommandCode</span>
            </span>
            <span className="font-mono text-body text-muted">deepseek/deepseek-v4.1-flash</span>
            <span className="w-14 text-right text-negative">Delete</span>
          </div>
          <div className="flex h-9 items-center gap-3 border-t border-rule">
            <span className="min-w-0 flex-1 text-body">
              <span className="text-text">mistral-1</span>
              <span className="text-muted"> · Mistral</span>
            </span>
            <Pill variant="warning">benched</Pill>
            <span className="font-mono text-body text-muted">mistral-small-latest</span>
            <span className="w-14" />
          </div>
          <div className="mt-1 border-t border-rule pt-2">
            <button
              type="button"
              className="h-[28px] rounded-control border border-control px-3 text-small text-text hover:border-muted"
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
            className="h-[var(--control-height)] rounded-control border border-negative px-4 text-sm text-negative hover:bg-pill-negative-bg"
          >
            Delete account
          </button>
          <span className="text-body text-muted">
            Esc/backdrop cancels; the confirm needs the typed account name.
          </span>
        </div>
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
