// Shapes and client for GET /admin/analytics/summary + /admin/analytics/timeseries (API.md, M2).

import { apiFetch } from "@/lib/api";
import { fmtCost, fmtInt } from "@/lib/format";

export interface Metrics {
  requests: number;
  errors: number;
  errorRate: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  toolCalls: number;
  costUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgTtftMs: number | null;
  p95TtftMs: number | null;
}

export type GroupBy = "provider" | "account" | "model" | "key" | "member";
export const GROUPS: readonly GroupBy[] = ["provider", "account", "model", "key", "member"];
export const GROUP_LABELS: Record<GroupBy, string> = {
  provider: "Provider",
  account: "Account",
  model: "Model",
  key: "Key",
  member: "Member",
};

export interface SummaryRow extends Metrics {
  key: string;
  label: string | null;
}
export interface Summary {
  from: string;
  to: string;
  groupBy: GroupBy;
  total: Metrics;
  rows: SummaryRow[];
}

export type TsMetric = "requests" | "tokens" | "cost" | "latency";
export interface TsSeries {
  key: string;
  label: string | null;
  /** `{ ts, value }` for value metrics, `{ ts, avg, p95 }` for latency. */
  points: Record<string, unknown>[];
}
export interface Timeseries {
  from: string;
  to: string;
  bucket: "hour" | "day";
  metric: string;
  series: TsSeries[];
}

export function fetchSummary(groupBy: GroupBy, from: Date, to: Date): Promise<Summary> {
  const q = new URLSearchParams({ groupBy, from: from.toISOString(), to: to.toISOString() });
  return apiFetch<Summary>(`/admin/analytics/summary?${q}`);
}

export function fetchTimeseries(
  metric: TsMetric,
  bucket: "hour" | "day",
  from: Date,
  to: Date,
): Promise<Timeseries> {
  const q = new URLSearchParams({ metric, bucket, from: from.toISOString(), to: to.toISOString() });
  return apiFetch<Timeseries>(`/admin/analytics/timeseries?${q}`);
}

/** The four tabs / panel metrics, mapped onto the Metrics fields. */
export type PanelMetric = "spend" | "latency" | "tokens" | "errors";
export interface MetricDef {
  id: PanelMetric;
  label: string;
  value: (m: Metrics) => number | null;
  format: (v: number) => string;
  /** Timeseries metric feeding the trend panel for this tab. */
  tsMetric: TsMetric;
}
export const METRICS: Record<PanelMetric, MetricDef> = {
  spend: { id: "spend", label: "Spend", value: (m) => m.costUsd, format: fmtCost, tsMetric: "cost" },
  latency: {
    id: "latency",
    label: "Avg latency",
    value: (m) => m.avgLatencyMs,
    format: (v) => `${fmtInt(Math.round(v))} ms`,
    tsMetric: "latency",
  },
  tokens: {
    id: "tokens",
    label: "Tokens",
    value: (m) => m.promptTokens + m.completionTokens,
    format: fmtInt,
    tsMetric: "tokens",
  },
  // CONTRACT: /admin/analytics/timeseries has no "errors" metric (enum: requests|tokens|cost|latency);
  // the errors tab plots the requests series with a caption.
  errors: { id: "errors", label: "Errors", value: (m) => m.errors, format: fmtInt, tsMetric: "requests" },
};
export const PANEL_METRICS: readonly PanelMetric[] = ["spend", "latency", "tokens", "errors"];

/** Row display name; a deleted entity's label resolves to NULL server-side. */
export function rowName(row: SummaryRow, groupBy: GroupBy): string {
  return row.label ?? `Unknown ${groupBy}`;
}

/** Latency figure without unit (KPI cells append the unit suffix themselves). */
export const fmtMs = (v: number): string => fmtInt(Math.round(v));

export const fmtRate = (r: number): string => `${(r * 100).toFixed(1)}%`;

/** Share of a group total: dash when the value is missing, "<1%" for honest tiny shares. */
export function fmtShare(share: number | null): string {
  if (share === null) return "–";
  const pct = share * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/** One { id, name, value, share } row per group, sorted by the active metric (nulls last). */
export interface RankedRow {
  id: string;
  name: string;
  value: number | null;
  share: number | null;
}

export function rankRows(rows: SummaryRow[], metric: PanelMetric, groupBy: GroupBy): RankedRow[] {
  const def = METRICS[metric];
  const sum = rows.reduce((acc, r) => acc + (def.value(r) ?? 0), 0);
  return rows
    .map((r) => {
      const value = def.value(r);
      return {
        id: r.key,
        name: rowName(r, groupBy),
        value,
        share: value === null ? null : sum > 0 ? value / sum : 0,
      };
    })
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}
