"use client";

// Stat cells in one divided strip (DESIGN.md stat-card): `label` secondary over a
// data-md mono foreground value with a secondary unit suffix; selection is a muted
// cell fill, never an accent line. Deltas stay as discrete secondary words.

export interface KpiItem {
  id: string;
  label: string;
  value: string | null; // null = missing → secondary dash
  unit?: string;
  /** Comparison line under the value ("+12% vs the 24h before"). */
  sub?: string;
  /** Kept for callers; deltas render in secondary regardless (DESIGN.md). */
  subTone?: "muted" | "positive" | "negative";
}

export function KpiStrip({
  items,
  selectedId,
  onSelect,
  cols,
}: {
  items: KpiItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** W14: force the column count (6 on /analytics); defaults to data-driven items.length. */
  cols?: number;
}) {
  return (
    <div
      className="grid grid-cols-[repeat(var(--kpi-cols),minmax(0,1fr))] divide-x divide-border max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-5 max-md:divide-x-0"
      // Cell count is data-driven (5 on W12, 7 with comparisons) — passed as a CSS var.
      style={{ "--kpi-cols": String(Math.max(cols ?? items.length, 1)) } as React.CSSProperties}
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
            className={`rounded-md px-4 py-3 text-left first:pl-4 max-md:px-0 max-md:py-0 ${
              selected ? "bg-muted" : ""
            }`}
          >
            <span className={`label block ${selected ? "text-foreground" : "text-secondary"}`}>
              {item.label}
            </span>
            <span className="mt-1 block leading-6">
              {item.value === null ? (
                <span className="text-small text-secondary">–</span>
              ) : (
                <>
                  <span className="data-md text-foreground">{item.value}</span>
                  {item.unit && (
                    <span className="ml-1 text-small text-secondary">{item.unit}</span>
                  )}
                </>
              )}
            </span>
            {item.sub !== undefined ? (
              <span className="mt-0.5 block text-small text-secondary">{item.sub}</span>
            ) : (
              <span className="mt-0.5 block text-small">&nbsp;</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
