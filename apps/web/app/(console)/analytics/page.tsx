"use client";

// Analytics — where do spend and latency come from (provider · account · model · key · member).
// Data: GET /admin/analytics/summary (grouped aggregates) + /admin/analytics/timeseries (trend).

import { useCallback, useEffect, useState } from "react";
import { ErrorBlock } from "@/components/ErrorBlock";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { PageTitle } from "@/components/PageTitle";
import { RangeTabs, type RangeOption } from "@/components/RangeTabs";
import { Skeleton } from "@/components/Skeleton";
import { UnderlineSelect } from "@/components/UnderlineSelect";
import {
  fetchSummary,
  fmtMs,
  fmtRate,
  GROUPS,
  rowName,
  type PanelMetric,
  type GroupBy,
  type Summary,
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

  const okSummary = summary.status === "ok" ? summary.data : null;

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
        <span className="flex h-[var(--control-height)] items-center gap-2 rounded-control border border-control px-3">
          <span className="text-body text-muted">Group by</span>
          <span className="text-rule">·</span>
          <UnderlineSelect
            options={GROUP_OPTIONS}
            value={groupBy}
            onChange={setGroupBy}
            ariaLabel="Group by"
          />
        </span>
      </div>

      <section aria-label="Window totals" className="rounded-card bg-surface p-1.5">
        {summary.status === "error" ? (
          <ErrorBlock error={summary.error} onRetry={loadSummary} />
        ) : summary.status === "loading" ? (
          <div className="grid grid-cols-6 max-md:grid-cols-2 max-md:gap-4">
            {KPI_IDS.map((id) => (
              <div key={id} className="px-4 py-3 max-md:px-0">
                <span className="block text-sm font-medium text-muted">{kpiLabel(id)}</span>
                <Skeleton className="mt-2 h-5 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <KpiStrip items={kpiItems(okSummary)} cols={6} />
        )}
      </section>
    </div>
  );
}
