// Wire shapes of the M2 endpoints consumed by the monitoring screens.
// CONTRACT: apps/api/API.md does not exist in the clone — shapes are taken
// from the route sources (apps/api/src/admin/*.ts), cited per block.

// GET /admin/requests (apps/api/src/admin/requests.ts)
export interface RequestRow {
  id: string;
  ts: string;
  requestedModel: string;
  upstreamModel: string | null;
  wireFormat: string;
  stream: boolean;
  status: "ok" | "error" | "aborted";
  httpStatus: number;
  errorCode: string | null;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  toolCallCount: number | null;
  finishReason: string | null;
  costUsd: number | null;
  clientName: string | null;
  key: { id: string; label: string; prefix: string } | null;
  member: { id: string; name: string } | null;
  account: { id: string; displayName: string; provider: string } | null;
  model: { id: string; name: string } | null;
}

export interface RequestsPage {
  rows: RequestRow[];
  nextCursor: string | null;
}

// GET /admin/analytics/feed `request` events (apps/api/src/lib/feedBus.ts).
// CONTRACT: the feed payload is thinner than a list row — no relation labels,
// no errorCode/reasoning/cached/toolCallCount/finishReason/clientName.
export interface FeedRow {
  id: string;
  ts: string;
  requestedModel: string;
  upstreamModel: string | null;
  wireFormat: string;
  stream: boolean;
  status: string;
  httpStatus: number;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  keyId: string | null;
  memberId: string | null;
  accountId: string | null;
  modelId: string | null;
}

// GET /admin/analytics/summary (apps/api/src/admin/analytics-summary.ts)
export interface SummaryMetrics {
  requests: number;
  errors: number;
  errorRate: number; // 0..1, 4 decimals
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

export interface SummaryResponse {
  from: string;
  to: string;
  groupBy: string;
  total: SummaryMetrics;
  rows: (SummaryMetrics & { key: string; label: string | null })[];
}

// GET /admin/analytics/timeseries (apps/api/src/admin/analytics-timeseries.ts)
export interface SeriesPointValue {
  ts: string;
  value: number;
}

export interface SeriesPointLatency {
  ts: string;
  avg: number | null;
  p95: number | null;
}

export interface TimeseriesResponse {
  from: string;
  to: string;
  bucket: "hour" | "day";
  metric: "requests" | "tokens" | "cost" | "latency";
  series: { key: string; label: string | null; points: (SeriesPointValue | SeriesPointLatency)[] }[];
}

// GET /admin/members (apps/api/src/admin/members.ts)
export interface Member {
  id: string;
  displayName: string;
  enabled: boolean;
}

// Active filter set for the requests screen; maps 1:1 onto query params.
export interface RequestFilters {
  status: "all" | "ok" | "error" | "aborted";
  memberId: string; // "" = all
  minLatencyMs: number | null;
  streamedOnly: boolean;
}

export const DEFAULT_FILTERS: RequestFilters = {
  status: "all",
  memberId: "",
  minLatencyMs: null,
  streamedOnly: false,
};

export function filtersQuery(f: RequestFilters): string {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.memberId) p.set("memberId", f.memberId);
  if (f.minLatencyMs !== null) p.set("minLatencyMs", String(f.minLatencyMs));
  if (f.streamedOnly) p.set("stream", "true");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Client-side filter match for live feed rows (same semantics as the API). */
export function feedRowMatches(row: FeedRow, f: RequestFilters): boolean {
  if (f.status !== "all" && row.status !== f.status) return false;
  if (f.memberId && row.memberId !== f.memberId) return false;
  if (f.minLatencyMs !== null && row.latencyMs < f.minLatencyMs) return false;
  if (f.streamedOnly && !row.stream) return false;
  return true;
}
