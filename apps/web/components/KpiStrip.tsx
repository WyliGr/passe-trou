"use client";

// Equal KPI cells in one divided strip: 14/500 muted label over a 20px/400 mono value with a muted
// unit suffix; the selected cell carries the 1px accent line exactly as wide as its label.

export interface KpiItem {
  id: string;
  label: string;
  value: string | null; // null = missing → grey dash at label size
  unit?: string;
  /** 12px comparison line under the value ("+12% vs the 24h before"). */
  sub?: string;
  /** Polarity rule: only error-rate and spend deltas carry colour. */
  subTone?: "muted" | "positive" | "negative";
}

export function KpiStrip({
  items,
  selectedId,
  onSelect,
}: {
  items: KpiItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div
      className="grid grid-cols-[repeat(var(--kpi-cols),minmax(0,1fr))] divide-x divide-rule max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:divide-x-0"
      // Cell count is data-driven (5 on W12, 7 with comparisons) — passed as a CSS var.
      style={{ "--kpi-cols": String(Math.max(items.length, 1)) } as React.CSSProperties}
      role={onSelect ? "tablist" : undefined}
    >
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            role={onSelect ? "tab" : undefined}
            aria-selected={onSelect ? selected : undefined}
            onClick={() => onSelect?.(item.id)}
            className="px-4 py-3 text-left first:pl-0 max-md:px-0 max-md:first:pl-0 max-md:py-0"
          >
            <span className="relative inline-block pb-[3px] text-sm font-medium text-muted">
              {item.label}
              {selected && (
                <span className="absolute inset-x-0 bottom-0 h-px bg-accent" aria-hidden="true" />
              )}
            </span>
            <span className="mt-1 block leading-6">
              {item.value === null ? (
                <span className="text-sm text-muted">–</span>
              ) : (
                <>
                  <span className="font-mono text-kpi text-text">{item.value}</span>
                  {item.unit && (
                    <span className="ml-1 text-sm text-muted">{item.unit}</span>
                  )}
                </>
              )}
            </span>
            {item.sub !== undefined ? (
              <span
                className={`mt-0.5 block text-small ${
                  item.subTone === "positive"
                    ? "text-positive"
                    : item.subTone === "negative"
                      ? "text-negative"
                      : "text-muted"
                }`}
              >
                {item.sub}
              </span>
            ) : (
              <span className="mt-0.5 block text-small">&nbsp;</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
