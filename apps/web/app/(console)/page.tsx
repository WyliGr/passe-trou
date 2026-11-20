"use client";

// Overview — one question first: is traffic flowing, and what did today cost?
// Title (finding + range presets) · request lane (live) · usage tray: KPI strip
// (the selected cell drives the chart below; comparison vs the previous window)
// · recent requests (5) · accounts · getting-started strip.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { LineChart, type LinePoint } from "@/components/LineChart";
import { PageTitle } from "@/components/PageTitle";
import { Pill } from "@/components/Pill";
import { RangeTabs, type RangeOption } from "@/components/RangeTabs";
import { RequestLane } from "@/components/RequestLane";
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import { requestColumns } from "@/components/requestColumns";
import { apiFetch } from "@/lib/api";
import { fmtCost, fmtDelta, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import type { Overview, OverviewAccount } from "@/lib/overview";
import type {
  RequestRow,
  RequestsPage,
  SeriesPointLatency,
  SeriesPointValue,
  SummaryMetrics,
  SummaryResponse,
  TimeseriesResponse,
} from "@/lib/requests";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok"; data: T };

const RANGES = [
  { id: "24h", label: "24h", ms: 24 * 3600_000, bucket: "hour" },
  { id: "7j", label: "7j", ms: 7 * 24 * 3600_000, bucket: "day" },
  { id: "30j", label: "30j", ms: 30 * 24 * 3600_000, bucket: "day" },
] as const;
type Range = (typeof RANGES)[number];

// KPI cells → timeseries metric, with the honest caption when the series
// differs from the label (combined tokens, latency standing in for ttft,
// total requests standing in for errors — see deviations-w13.log CONTRACT notes).
const KPIS = [
  { id: "requests", label: "Requests", metric: "requests" },
  { id: "tokensIn", label: "Tokens in", metric: "tokens", caption: "combined in+out" },
  { id: "tokensOut", label: "Tokens out", metric: "tokens", caption: "combined in+out" },
  { id: "spend", label: "Spend", metric: "cost" },
  { id: "ttft", label: "Avg TTFT", metric: "latency", caption: "upstream latency — no ttft series" },
  { id: "latency", label: "Avg latency", metric: "latency" },
  { id: "errorRate", label: "Error rate", metric: "requests", caption: "total requests — no errors series" },
] as const;
type KpiId = (typeof KPIS)[number]["id"];

function accountStatus(a: OverviewAccount): { label: string; variant: "neutral" | "warning" } {
  if (a.cooling) return { label: "cooling down", variant: "warning" };
  return a.enabled
    ? { label: "active", variant: "neutral" }
    : { label: "benched", variant: "warning" };
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

function ms(v: number | null): string | null {
  return v === null ? null : fmtMs(v);
}

/** "+12%" vs previous, or null when the previous window had nothing. */
function deltaSub(
  cur: number,
  prev: number,
  rangeLabel: string,
): string {
  const d = fmtDelta(cur, prev);
  return d === null ? "no prior data" : `${d} vs the ${rangeLabel} before`;
}

function buildKpis(cur: SummaryMetrics, prev: SummaryMetrics, rangeLabel: string): KpiItem[] {
  // Polarity rule: only the error-rate cell and the spend delta carry colour.
  const spendDelta = fmtDelta(cur.costUsd, prev.costUsd);
  const errDelta = fmtDelta(cur.errorRate, prev.errorRate);
  return [
    {
      id: "requests",
      label: "Requests",
      value: fmtInt(cur.requests),
      sub: deltaSub(cur.requests, prev.requests, rangeLabel),
    },
    {
      id: "tokensIn",
      label: "Tokens in",
      value: fmtInt(cur.promptTokens),
      sub: deltaSub(cur.promptTokens, prev.promptTokens, rangeLabel),
    },
    {
      id: "tokensOut",
      label: "Tokens out",
      value: fmtInt(cur.completionTokens),
      sub: deltaSub(cur.completionTokens, prev.completionTokens, rangeLabel),
    },
    {
      id: "spend",
      label: "Spend",
      value: fmtCost(cur.costUsd),
      sub: spendDelta === null ? "no prior data" : `${spendDelta} vs the ${rangeLabel} before`,
      subTone:
        spendDelta === null || cur.costUsd === prev.costUsd
          ? "muted"
          : cur.costUsd > prev.costUsd
            ? "negative"
            : "positive",
    },
    {
      id: "ttft",
      label: "Avg TTFT",
      value: ms(cur.avgTtftMs),
      sub:
        cur.avgTtftMs === null || prev.avgTtftMs === null
          ? "–"
          : deltaSub(cur.avgTtftMs, prev.avgTtftMs, rangeLabel),
    },
    {
      id: "latency",
      label: "Avg latency",
      value: ms(cur.avgLatencyMs),
      sub:
        cur.avgLatencyMs === null || prev.avgLatencyMs === null
          ? "–"
          : deltaSub(cur.avgLatencyMs, prev.avgLatencyMs, rangeLabel),
    },
    {
      id: "errorRate",
      label: "Error rate",
      value: fmtPct(cur.errorRate),
      sub: errDelta === null ? "no prior data" : `${errDelta} vs the ${rangeLabel} before`,
      subTone:
        errDelta === null || cur.errorRate === prev.errorRate
          ? "muted"
          : cur.errorRate > prev.errorRate
            ? "negative"
            : "positive",
    },
  ];
}

export default function OverviewPage() {
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("24h");
  const [kpiId, setKpiId] = useState<KpiId>("requests");
  const [overview, setOverview] = useState<Load<Overview>>({ status: "loading" });
  const [summary, setSummary] = useState<Load<{ cur: SummaryResponse; prev: SummaryResponse }>>({
    status: "loading",
  });
  const [series, setSeries] = useState<Load<TimeseriesResponse>>({ status: "loading" });
  const [recent, setRecent] = useState<Load<RequestRow[]>>({ status: "loading" });
  const [hourCount, setHourCount] = useState<number | null>(null);

  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const kpi = KPIS.find((k) => k.id === kpiId) ?? KPIS[0];

  const loadOverview = useCallback(async () => {
    setOverview((s) => (s.status === "ok" ? s : { status: "loading" }));
    try {
      setOverview({ status: "ok", data: await apiFetch<Overview>("/admin/overview") });
    } catch (error) {
      setOverview({ status: "error", error });
    }
  }, []);

  const loadRecent = useCallback(async () => {
    setRecent((s) => (s.status === "ok" ? s : { status: "loading" }));
    try {
      const page = await apiFetch<RequestsPage>("/admin/requests?limit=5");
      setRecent({ status: "ok", data: page.rows });
    } catch (error) {
      setRecent({ status: "error", error });
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadRecent();
    // Finding fallback: exact request count of the last hour.
    const from = new Date(Date.now() - 3600_000).toISOString();
    apiFetch<SummaryResponse>(`/admin/analytics/summary?groupBy=provider&from=${from}`)
      .then((s) => setHourCount(s.total.requests))
      .catch(() => setHourCount(null));
  }, [loadOverview, loadRecent]);

  const loadSummary = useCallback(async (r: Range) => {
    setSummary({ status: "loading" });
    const toMs = Date.now();
    const fromMs = toMs - r.ms;
    const q = (from: number, to: number) =>
      `/admin/analytics/summary?groupBy=provider&from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`;
    try {
      const [cur, prev] = await Promise.all([
        apiFetch<SummaryResponse>(q(fromMs, toMs)),
        apiFetch<SummaryResponse>(q(fromMs - r.ms, fromMs)),
      ]);
      setSummary({ status: "ok", data: { cur, prev } });
    } catch (error) {
      setSummary({ status: "error", error });
    }
  }, []);

  const loadSeries = useCallback(async (k: (typeof KPIS)[number], r: Range) => {
    setSeries({ status: "loading" });
    const toMs = Date.now();
    const q =
      `/admin/analytics/timeseries?metric=${k.metric}&bucket=${r.bucket}` +
      `&from=${new Date(toMs - r.ms).toISOString()}&to=${new Date(toMs).toISOString()}`;
    try {
      setSeries({ status: "ok", data: await apiFetch<TimeseriesResponse>(q) });
    } catch (error) {
      setSeries({ status: "error", error });
    }
  }, []);

  useEffect(() => {
    void loadSummary(range);
  }, [loadSummary, range]);
  useEffect(() => {
    void loadSeries(kpi, range);
  }, [loadSeries, kpi, range]);

  const kpis: KpiItem[] = useMemo(() => {
    if (summary.status !== "ok") {
      return KPIS.map((k) => ({ id: k.id, label: k.label, value: null }));
    }
    return buildKpis(summary.data.cur.total, summary.data.prev.total, range.label);
  }, [summary, range.label]);

  // Chart points for the selected KPI (ungrouped series "all"; latency → avg + p95).
  const chart = useMemo((): {
    points: LinePoint[];
    secondary?: LinePoint[];
    latency?: boolean;
  } => {
    if (series.status !== "ok") return { points: [] };
    const s = series.data.series[0];
    if (!s) return { points: [] };
    if (series.data.metric === "latency") {
      const pts = s.points as SeriesPointLatency[];
      return {
        points: pts.map((p) => ({ ts: Date.parse(p.ts), value: p.avg })),
        secondary: pts.map((p) => ({ ts: Date.parse(p.ts), value: p.p95 })),
        latency: true,
      };
    }
    return {
      points: (s.points as SeriesPointValue[]).map((p) => ({
        ts: Date.parse(p.ts),
        value: p.value,
      })),
    };
  }, [series]);

  const finding = useMemo((): string | undefined => {
    if (summary.status === "ok") {
      const { errorRate } = summary.data.cur.total;
      if (errorRate > 0.01) {
        return `error rate ${fmtPct(errorRate)} in the last ${range.label}`;
      }
    }
    if (overview.status === "ok") {
      const benched = overview.data.accounts.filter((a) => !a.enabled).length;
      if (benched > 0) return `${benched} account${benched === 1 ? "" : "s"} benched`;
    }
    if (hourCount !== null) {
      return `${fmtInt(hourCount)} request${hourCount === 1 ? "" : "s"} in the last hour`;
    }
    return undefined;
  }, [summary, overview, hourCount, range.label]);

  const formatChartValue = useMemo(() => {
    if (kpi.metric === "cost") return (v: number) => fmtCost(v);
    if (chart.latency) return (v: number) => fmtMs(v);
    return (v: number) => fmtInt(v);
  }, [kpi.metric, chart.latency]);

  const accountOk = overview.status === "ok" ? overview.data : null;
  const steps = accountOk
    ? [
        { title: "Add a provider", done: accountOk.counts.providers > 0 },
        { title: "Add an account + credential", done: accountOk.counts.accounts > 0 },
        { title: "Map a model", done: accountOk.counts.models > 0 },
        { title: "Create a member key", done: accountOk.counts.keys > 0 },
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
          {...(finding && { finding })}
          actions={
            <RangeTabs
              options={RANGES as unknown as readonly RangeOption[]}
              value={rangeId}
              onChange={(v) => setRangeId(v as (typeof RANGES)[number]["id"])}
              ariaLabel="Time range"
            />
          }
        />
      </div>

      <RequestLane />

      <section aria-label="Usage" className="rounded-card bg-surface p-1.5">
        {summary.status === "error" ? (
          <ErrorBlock error={summary.error} onRetry={() => loadSummary(range)} />
        ) : summary.status === "loading" ? (
          <div className="grid grid-cols-7 max-md:grid-cols-2 max-md:gap-4">
            {KPIS.map((k) => (
              <div key={k.id} className="px-4 py-3 max-md:px-0">
                <span className="block text-sm font-medium text-muted">&nbsp;</span>
                <Skeleton className="mt-2 h-5 w-20" />
                <Skeleton className="mt-1.5 h-3 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <KpiStrip items={kpis} selectedId={kpiId} onSelect={(id) => setKpiId(id as KpiId)} />
        )}
        <div className="mt-1.5 rounded-card bg-ground p-6">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-base font-semibold">{kpi.label}</h2>
            {"caption" in kpi && kpi.caption && (
              <span className="text-small text-muted">{kpi.caption}</span>
            )}
          </div>
          {series.status === "error" ? (
            <ErrorBlock error={series.error} onRetry={() => loadSeries(kpi, range)} />
          ) : series.status === "loading" ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <LineChart
              points={chart.points}
              {...(chart.secondary ? { secondary: chart.secondary, legend: { primary: "avg", secondary: "p95" } } : {})}
              formatValue={formatChartValue}
              ariaLabel={`${kpi.label} per ${range.bucket}, last ${range.label}`}
            />
          )}
        </div>
      </section>

      <section aria-label="Recent requests" className="rounded-card bg-surface p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent requests</h2>
          <Link href="/requests" className="text-sm text-muted hover:text-text">
            View all →
          </Link>
        </div>
        {recent.status === "error" ? (
          <ErrorBlock error={recent.error} onRetry={loadRecent} />
        ) : recent.status === "loading" ? (
          <SkeletonRows rows={5} />
        ) : recent.data.length === 0 ? (
          <Empty sentence="No requests yet — create a member key and call /v1/chat/completions." />
        ) : (
          <Table columns={requestColumns()} rows={recent.data} rowKey={(r) => r.id} />
        )}
      </section>

      <section aria-label="Accounts" className="rounded-card bg-surface p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Accounts</h2>
          <Link href="/providers" className="text-sm text-muted hover:text-text">
            View all →
          </Link>
        </div>
        {overview.status === "error" ? (
          <ErrorBlock error={overview.error} onRetry={loadOverview} />
        ) : overview.status === "loading" ? (
          <SkeletonRows rows={4} />
        ) : overview.data.accounts.length === 0 ? (
          <Empty sentence="No accounts yet — add a provider, then an account with its credential." />
        ) : (
          <Table columns={ACCOUNT_COLUMNS} rows={overview.data.accounts.slice(0, 5)} rowKey={(a) => a.id} />
        )}
      </section>

      {!setupDone && overview.status === "ok" && (
        <section
          aria-label="Getting started"
          className="grid grid-cols-4 divide-x divide-rule rounded-card bg-surface max-md:grid-cols-2 max-md:divide-x-0"
        >
          {steps.map((s, i) => (
            <div key={s.title} className="relative p-4">
              {!s.done && (
                <span aria-hidden="true" className="absolute right-4 top-4 text-sm text-muted">
                  →
                </span>
              )}
              <p className={`text-sm font-medium ${s.done ? "text-muted line-through" : "text-text"}`}>
                <span className="mr-1 font-mono text-muted">{i + 1}.</span>
                {s.title}
              </p>
              <p className="mt-1 text-body text-muted">{s.done ? "Done" : GETTING_STARTED_HINTS[i]}</p>
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
