"use client";

// Overview v1 — one question first: is traffic flowing, and what did today cost?
// Grid: canvas --pad 32px, one --gap 24px between blocks; every block shares both canvas edges.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorBlock } from "@/components/ErrorBlock";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { PageTitle } from "@/components/PageTitle";
import { Pill } from "@/components/Pill";
import { RangeTabs, type RangeOption } from "@/components/RangeTabs";
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import { Empty } from "@/components/Empty";
import { apiFetch } from "@/lib/api";
import { fmtCost, fmtInt } from "@/lib/format";
import type { Overview, OverviewAccount } from "@/lib/overview";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok"; data: Overview };

const RANGES = [
  { id: "24h", label: "24h" },
  { id: "7j", label: "7j" },
  { id: "30j", label: "30j" },
] as const satisfies readonly RangeOption[];
type Range = (typeof RANGES)[number]["id"];

function accountStatus(a: OverviewAccount): { label: string; variant: "neutral" | "warning" } {
  if (a.cooling) return { label: "cooling down", variant: "warning" };
  return a.enabled
    ? { label: "active", variant: "neutral" }
    : { label: "benched", variant: "warning" };
}

function findingLine(d: Overview): string {
  if (d.today.requests === 0) return "No traffic yet.";
  const benched = d.accounts.filter((a) => !a.enabled).length;
  const cooling = d.accounts.filter((a) => a.enabled && a.cooling).length;
  const active = d.accounts.length - benched - cooling;
  const parts = [`${active} account${active === 1 ? "" : "s"} active`];
  if (cooling > 0) parts.push(`${cooling} cooling down`);
  if (benched > 0) parts.push(`${benched} benched`);
  return parts.join(", ");
}

const ACCOUNT_COLUMNS: Column<OverviewAccount>[] = [
  { key: "label", header: "Account" },
  {
    key: "provider",
    header: "Provider",
    render: (a) => <span className="text-muted">{a.provider}</span>,
  },
  {
    key: "status",
    header: "Status",
    render: (a) => {
      const s = accountStatus(a);
      return <Pill variant={s.variant}>{s.label}</Pill>;
    },
  },
  {
    key: "todayRequests",
    header: "Requests today",
    align: "right",
    render: (a) => fmtInt(a.todayRequests),
  },
  {
    key: "todayCostUsd",
    header: "Cost today",
    align: "right",
    render: (a) => <span className="text-muted">{fmtCost(a.todayCostUsd)}</span>,
  },
];

export default function OverviewPage() {
  // Range is visual state only until the timeseries endpoint (M2, W13) feeds the chart.
  const [range, setRange] = useState<Range>("24h");
  const [kpiId, setKpiId] = useState("requests");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setState((s) => (s.status === "ok" ? s : { status: "loading" }));
    try {
      setState({ status: "ok", data: await apiFetch<Overview>("/admin/overview") });
    } catch (error) {
      setState({ status: "error", error });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ok = state.status === "ok" ? state.data : null;
  const activeAccounts = ok
    ? ok.accounts.filter((a) => a.enabled && !a.cooling).length
    : 0;

  const kpis: KpiItem[] = ok
    ? [
        { id: "requests", label: "Requests", value: fmtInt(ok.today.requests) },
        { id: "tokensIn", label: "Tokens in", value: fmtInt(ok.today.tokensIn) },
        { id: "tokensOut", label: "Tokens out", value: fmtInt(ok.today.tokensOut) },
        { id: "spend", label: "Spend", value: fmtCost(ok.today.costUsd) },
        { id: "accounts", label: "Active accounts", value: fmtInt(activeAccounts) },
      ]
    : [
        { id: "requests", label: "Requests", value: null },
        { id: "tokensIn", label: "Tokens in", value: null },
        { id: "tokensOut", label: "Tokens out", value: null },
        { id: "spend", label: "Spend", value: null },
        { id: "accounts", label: "Active accounts", value: null },
      ];

  const steps = ok
    ? [
        { title: "Add a provider", done: ok.counts.providers > 0 },
        { title: "Add an account + credential", done: ok.counts.accounts > 0 },
        { title: "Map a model", done: ok.counts.models > 0 },
        { title: "Create a member key", done: ok.counts.keys > 0 },
      ]
    : [];
  const setupDone = steps.length > 0 && steps.every((s) => s.done);

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <div>
        <div className="mb-3 text-[15px] font-semibold">
          passe<span className="text-accent">•</span>trou
        </div>
        <PageTitle
          title="Overview"
          {...(state.status === "ok" && { finding: findingLine(state.data) })}
          {...(state.status === "loading" && {
            finding: "Reading today's aggregates…",
          })}
          actions={<RangeTabs options={RANGES} value={range} onChange={setRange} />}
        />
      </div>

      {/* W13: request lane (SSE) */}

      <section aria-label="Usage today" className="rounded-card bg-surface p-1.5">
        {state.status === "error" ? (
          <ErrorBlock error={state.error} onRetry={load} />
        ) : state.status === "loading" ? (
          <div className="grid grid-cols-5 max-md:grid-cols-2 max-md:gap-4">
            {["requests", "tokensIn", "tokensOut", "spend", "accounts"].map((id) => (
              <div key={id} className="px-4 py-3 max-md:px-0">
                <span className="block text-sm font-medium text-muted">&nbsp;</span>
                <Skeleton className="mt-2 h-5 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <KpiStrip items={kpis} selectedId={kpiId} onSelect={setKpiId} />
        )}
      </section>

      <section aria-label="Requests chart" className="rounded-card bg-surface p-6">
        <h2 className="mb-4 text-base font-semibold">Requests</h2>
        {state.status === "error" ? (
          <ErrorBlock error={state.error} onRetry={load} />
        ) : state.status === "loading" ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          // /admin/overview exposes today aggregates only, no series — honest empty frame until M2.
          <Empty
            sentence="No time series yet — per-hour points land with the analytics endpoints in M2; today's totals are in the tray above."
          />
        )}
      </section>

      <section aria-label="Recent accounts" className="rounded-card bg-surface p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent accounts</h2>
          <Link href="/providers" className="text-sm text-muted hover:text-text">
            View all →
          </Link>
        </div>
        {state.status === "error" ? (
          <ErrorBlock error={state.error} onRetry={load} />
        ) : state.status === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state.data.accounts.length === 0 ? (
          <Empty sentence="No accounts yet — add a provider, then an account with its credential." />
        ) : (
          <Table
            columns={ACCOUNT_COLUMNS}
            rows={state.data.accounts.slice(0, 5)}
            rowKey={(a) => a.id}
          />
        )}
      </section>

      {!setupDone && state.status === "ok" && (
        <section
          aria-label="Getting started"
          className="grid grid-cols-4 divide-x divide-rule rounded-card bg-surface max-md:grid-cols-2 max-md:divide-x-0"
        >
          {steps.map((s, i) => (
            <div key={s.title} className="relative p-4">
              {!s.done && (
                <span
                  aria-hidden="true"
                  className="absolute right-4 top-4 text-sm text-muted"
                >
                  →
                </span>
              )}
              <p
                className={`text-sm font-medium ${
                  s.done ? "text-muted line-through" : "text-text"
                }`}
              >
                <span className="mr-1 font-mono text-muted">{i + 1}.</span>
                {s.title}
              </p>
              <p className="mt-1 text-body text-muted">
                {s.done ? "Done" : GETTING_STARTED_HINTS[i]}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const GETTING_STARTED_HINTS = [
  "Point it at an upstream base URL.",
  "Store the subscription's API key.",
  "Publish a logical model onto accounts.",
  "Mint a pt_… bearer for the proxy.",
];
