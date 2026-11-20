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

/** ISO date for created columns (§7.4: ISO form where rows are compared). */
export const fmtDay = (iso: string): string => iso.slice(0, 10);

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
