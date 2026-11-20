// Number formats per app-screens.md §7.4: thousands separators, fixed decimals per metric.

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const cost = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Counts: no decimals, thousands separators. */
export const fmtInt = (v: number): string => int.format(v);

/** Cost in USD: fixed 4 decimals, no space after the sign. */
export const fmtCost = (v: number): string => `$${cost.format(v)}`;

/** Axis ticks only: compact magnitude (1.2k). */
export const fmtCompact = (v: number): string => compact.format(v);

/** Chart x labels: clock when the span is hours, day + month beyond that. */
export function fmtAxisTs(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 48 * 3600_000) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

/** Full timestamp + value for chart tooltips. */
export function fmtPointTs(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (spanMs <= 48 * 3600_000) return clock;
  return `${fmtAxisTs(ts, spanMs)} ${clock}`;
}

/** Milliseconds with unit: 824 ms, 1.2 s beyond 10s. */
export function fmtMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

/** Relative clock for list rows: 12s ago, 3m ago, 2h ago, else day+month. */
export function fmtRel(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "–";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return fmtAxisTs(t, 90 * 24 * 3600_000);
}

/** Error rate as a percentage with 1 decimal: 4.1%. */
export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Signed percent delta vs a previous value; null when there is no base. */
export function fmtDelta(cur: number, prev: number): string | null {
  if (prev === 0) return cur === 0 ? "+0%" : null;
  const pct = ((cur - prev) / prev) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}
