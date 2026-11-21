"use client";

// Analytics — where do spend and latency come from (provider · account · model · key · member).
// Data: GET /admin/analytics/summary (grouped aggregates) + /admin/analytics/timeseries (trend).

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { LineChart, type LinePoint } from "@/components/LineChart";
import { PageTitle } from "@/components/PageTitle";
import { Pill } from "@/components/Pill";
import { RangeTabs, type RangeOption } from "@/components/RangeTabs";
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import { UnderlineSelect, type SelectOption } from "@/components/UnderlineSelect";
import {
  fetchSummary,
  fetchTimeseries,
  fmtMs,
  fmtRate,
  GROUPS,
  GROUP_LABELS,
  METRICS,
  PANEL_METRICS,
  rankRows,
  rowName,
  type PanelMetric,
  type GroupBy,
  type Summary,
  type Timeseries,
} from "@/lib/analytics";
import { fmtCost, fmtInt } from "@/lib/format";

type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok"; data: T };

const RANGES = [
  { id: "24h", label: "24h" },
  { id: "7j", label: "7j" },
  { id: "30j", label: "30j" },
] as const satisfies readonly RangeOption[];
type Range = (typeof RANGES)[number]["id"];
const RANGE_MS: Record<Range, number> = {
  "24h": 24 * 3600_000,
  "7j": 7 * 24 * 3600_000,
  "30j": 30 * 24 * 3600_000,
};
const RANGE_WORD: Record<Range, string> = {
  "24h": "today's",
  "7j": "this week's",
  "30j": "this month's",
};

const TABS = [
  { id: "spend", label: "Spend" },
  { id: "latency", label: "Latency" },
  { id: "tokens", label: "Tokens" },
  { id: "errors", label: "Errors" },
] as const satisfies readonly RangeOption[];

const GROUP_OPTIONS = GROUPS.map((g) => ({ id: g, label: g }));
const METRIC_OPTIONS: readonly SelectOption[] = PANEL_METRICS.map((m) => ({
  id: m,
  label: METRICS[m].label,
}));

/** Panel chrome: 73px header (14/600 title + 13px muted description + metric dropdown)
 *  over a full-bleed 1px rule. */
function PanelHeader({
  title,
  description,
  metric,
  onMetric,
}: {
  title: string;
  description: string;
  metric?: PanelMetric;
  onMetric?: (m: PanelMetric) => void;
}) {
  return (
    <>
      <div className="flex h-[73px] items-center justify-between gap-4">
        <div>
          <h3 className="h3">{title}</h3>
          <p className="mt-1 text-body text-secondary">{description}</p>
        </div>
        {metric !== undefined && onMetric && (
          <UnderlineSelect
            options={METRIC_OPTIONS}
            value={metric}
            onChange={onMetric}
            ariaLabel={`${title} metric`}
          />
        )}
      </div>
      <div aria-hidden="true" className="-mx-6 border-t border-border" />
    </>
  );
}

/** Bar-list skeleton at the real 64px row pitch. */
function BarListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-16 flex-col justify-center gap-2.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}

const KPI_IDS = ["requests", "tokens", "spend", "avgLatency", "p95Latency", "errorRate"] as const;

/** The six equal KPI cells, filled from summary.total for the window. */
function kpiItems(s: Summary | null): KpiItem[] {
  const t = s?.total;
  if (!t) {
    return KPI_IDS.map((id) => ({
      id,
      label: kpiLabel(id),
      value: null,
    }));
  }
  return [
    { id: "requests", label: "Requests", value: fmtInt(t.requests) },
    { id: "tokens", label: "Tokens", value: fmtInt(t.promptTokens + t.completionTokens) },
    { id: "spend", label: "Spend", value: fmtCost(t.costUsd) },
    {
      id: "avgLatency",
      label: "Avg latency",
      value: t.avgLatencyMs === null ? null : fmtMs(t.avgLatencyMs),
      unit: "ms",
    },
    {
      id: "p95Latency",
      label: "P95 latency",
      value: t.p95LatencyMs === null ? null : fmtMs(t.p95LatencyMs),
      unit: "ms",
    },
    { id: "errorRate", label: "Error rate", value: fmtRate(t.errorRate) },
  ];
}

function kpiLabel(id: (typeof KPI_IDS)[number]): string {
  return {
    requests: "Requests",
    tokens: "Tokens",
    spend: "Spend",
    avgLatency: "Avg latency",
    p95Latency: "P95 latency",
    errorRate: "Error rate",
  }[id];
}

/** The one fact under the title: the top cost driver's share of the window's spend. */
function findingLine(s: Summary, range: Range): string {
  if (s.total.requests === 0) return "No traffic in this window.";
  const top = [...s.rows].sort((a, b) => b.costUsd - a.costUsd)[0];
  if (!top || s.total.costUsd <= 0 || top.costUsd <= 0) {
    return "No spend recorded in this window.";
  }
  const share = Math.round((top.costUsd / s.total.costUsd) * 100);
  return `${rowName(top, s.groupBy)} carries ${share}% of ${RANGE_WORD[range]} spend`;
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("7j");
  const [tab, setTabRaw] = useState<PanelMetric>("spend");
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  // Panel metric dropdowns default to the active tab; switching tabs resets them.
  const [leftMetric, setLeftMetric] = useState<PanelMetric | null>(null);
  const [rightMetric, setRightMetric] = useState<PanelMetric | null>(null);
  const setTab = (t: PanelMetric) => {
    setTabRaw(t);
    setLeftMetric(null);
    setRightMetric(null);
  };

  const [summary, setSummary] = useState<LoadState<Summary>>({ status: "loading" });
  const loadSummary = useCallback(async () => {
    setSummary((s) => (s.status === "ok" ? s : { status: "loading" }));
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_MS[range]);
    try {
      setSummary({ status: "ok", data: await fetchSummary(groupBy, from, to) });
    } catch (error) {
      setSummary({ status: "error", error });
    }
  }, [range, groupBy]);
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // Trend for the active tab: hour buckets for 24h, day buckets beyond.
  const [series, setSeries] = useState<LoadState<Timeseries>>({ status: "loading" });
  const loadSeries = useCallback(async () => {
    setSeries((s) => (s.status === "ok" ? s : { status: "loading" }));
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_MS[range]);
    const bucket = range === "24h" ? "hour" : "day";
    try {
      setSeries({
        status: "ok",
        data: await fetchTimeseries(METRICS[tab].tsMetric, bucket, from, to),
      });
    } catch (error) {
      setSeries({ status: "error", error });
    }
  }, [range, tab]);
  useEffect(() => {
    void loadSeries();
  }, [loadSeries]);

  const okSummary = summary.status === "ok" ? summary.data : null;

  // Ungrouped series → one { key: "all" } entry; latency points carry avg + p95.
  const trend = useMemo<{ primary: LinePoint[]; overlay: LinePoint[] | null } | null>(() => {
    if (series.status !== "ok") return null;
    const s = series.data.series[0];
    if (!s) return { primary: [], overlay: null };
    if (tab === "latency") {
      const avg: LinePoint[] = [];
      const p95: LinePoint[] = [];
      for (const p of s.points as unknown as {
        ts: string;
        avg: number | null;
        p95: number | null;
      }[]) {
        const t = Date.parse(p.ts);
        if (p.avg !== null) avg.push({ ts: t, value: p.avg });
        if (p.p95 !== null) p95.push({ ts: t, value: p.p95 });
      }
      return { primary: avg, overlay: p95 };
    }
    const pts = (s.points as unknown as { ts: string; value: number }[]).map((p) => ({
      ts: Date.parse(p.ts),
      value: p.value,
    }));
    return { primary: pts, overlay: null };
  }, [series, tab]);

  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? tab;
  const activeLeft = leftMetric ?? tab;
  const activeRight = rightMetric ?? tab;
  const rightDef = METRICS[activeRight];
  const ranked = okSummary ? rankRows(okSummary.rows, activeLeft, groupBy) : [];
  const rankedRight = okSummary ? rankRows(okSummary.rows, activeRight, groupBy) : [];

  const rankingColumns: Column<(typeof rankedRight)[number]>[] = [
    {
      key: "rank",
      header: "#",
      render: (r) => (
        <span className="text-secondary">{rankedRight.indexOf(r) + 1}</span>
      ),
    },
    {
      key: "name",
      header: GROUP_LABELS[groupBy],
      render: (r) =>
        rankedRight.indexOf(r) === 0 ? <Pill variant="neutral">{r.name}</Pill> : r.name,
    },
    {
      key: "value",
      header: rightDef.label,
      align: "right",
      render: (r) =>
        r.value === null ? (
          <span className="text-secondary">–</span>
        ) : (
          rightDef.format(r.value)
        ),
    },
  ];

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Analytics"
        {...(okSummary && { finding: findingLine(okSummary, range) })}
        {...(summary.status === "loading" && { finding: "Reading aggregates…" })}
        actions={<RangeTabs options={RANGES} value={range} onChange={setRange} />}
      />

      <RangeTabs options={TABS} value={tab} onChange={setTab} ariaLabel="Metric" />

      <div className="flex items-center">
        <span className="flex h-[var(--control-height)] items-center gap-2 rounded-full bg-muted px-3">
          <span className="text-body text-secondary">Group by</span>
          <span className="text-border">·</span>
          <UnderlineSelect
            options={GROUP_OPTIONS}
            value={groupBy}
            onChange={setGroupBy}
            ariaLabel="Group by"
          />
        </span>
      </div>

      <section aria-label="Window totals" className="rounded-lg bg-surface p-1.5">
        {summary.status === "error" ? (
          <ErrorBlock error={summary.error} onRetry={loadSummary} />
        ) : summary.status === "loading" ? (
          <div className="grid grid-cols-6 max-md:grid-cols-2 max-md:gap-4">
            {KPI_IDS.map((id) => (
              <div key={id} className="px-4 py-3 max-md:px-0">
                <span className="block text-sm font-medium text-secondary">{kpiLabel(id)}</span>
                <Skeleton className="mt-2 h-5 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <KpiStrip items={kpiItems(okSummary)} cols={6} />
        )}
      </section>

      <div className="grid grid-cols-2 max-md:grid-cols-1" style={{ gap: "var(--gap)" }}>
        <section aria-label="By group" className="rounded-lg bg-surface p-6">
          <PanelHeader
            title="By group"
            description={`${METRICS[activeLeft].label} by ${groupBy}, sorted`}
            metric={activeLeft}
            onMetric={setLeftMetric}
          />
          <div className="pt-4">
            {summary.status === "error" ? (
              <ErrorBlock error={summary.error} onRetry={loadSummary} />
            ) : summary.status === "loading" ? (
              <BarListSkeleton />
            ) : ranked.length === 0 ? (
              <Empty sentence="No data in this window." />
            ) : (
              <BarList
                rows={ranked}
                formatValue={METRICS[activeLeft].format}
                ariaLabel={`${METRICS[activeLeft].label} by ${groupBy}`}
              />
            )}
          </div>
        </section>

        <section aria-label="Ranking" className="rounded-lg bg-surface p-6">
          <PanelHeader
            title="Ranking"
            description={`All ${groupBy}s by ${rightDef.label.toLowerCase()}`}
            metric={activeRight}
            onMetric={setRightMetric}
          />
          <div className="pt-4">
            {summary.status === "error" ? (
              <ErrorBlock error={summary.error} onRetry={loadSummary} />
            ) : summary.status === "loading" ? (
              <SkeletonRows rows={8} rowHeight="53px" />
            ) : rankedRight.length === 0 ? (
              <Empty sentence="No data in this window." />
            ) : (
              <Table
                columns={rankingColumns}
                rows={rankedRight}
                rowKey={(r) => r.id}
                rowHeight="53px"
              />
            )}
          </div>
        </section>
      </div>

      <section aria-label="Trend" className="rounded-lg bg-surface p-6">
        <PanelHeader
          title={tabLabel}
          description={`Per ${range === "24h" ? "hour" : "day"} across the window`}
        />
        <div className="pt-4">
          {tab === "errors" && series.status === "ok" && (
            <p className="mb-3 text-body text-secondary">
              Error counts are not bucketed by the API — showing requests for context.
            </p>
          )}
          {series.status === "error" ? (
            <ErrorBlock error={series.error} onRetry={loadSeries} />
          ) : series.status === "loading" || trend === null ? (
            <Skeleton className="h-[220px] w-full" />
          ) : trend.primary.length === 0 ? (
            <Empty sentence="No data in this window." />
          ) : (
            <LineChart
              points={trend.primary}
              height={220}
              formatValue={METRICS[tab].format}
              ariaLabel={`${tabLabel} per ${range === "24h" ? "hour" : "day"}`}
              {...(trend.overlay
                ? { label: "Avg", overlay: { points: trend.overlay, label: "P95" } }
                : {})}
            />
          )}
        </div>
      </section>
    </div>
  );
}
