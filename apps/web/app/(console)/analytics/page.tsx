"use client";

// Analytics — where do spend and latency come from (provider · account · model · key · member).
// Data: GET /admin/analytics/summary (grouped aggregates) + /admin/analytics/timeseries (trend).

import { useCallback, useEffect, useState } from "react";
import { PageTitle } from "@/components/PageTitle";
import { RangeTabs, type RangeOption } from "@/components/RangeTabs";
import { UnderlineSelect } from "@/components/UnderlineSelect";
import {
  fetchSummary,
  GROUPS,
  rowName,
  type PanelMetric,
  type GroupBy,
  type Summary,
} from "@/lib/analytics";

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

      <pre className="text-small text-muted">
        {okSummary ? `rows: ${okSummary.rows.length} (KPI + panels next)` : "\u00a0"}
      </pre>
    </div>
  );
}
