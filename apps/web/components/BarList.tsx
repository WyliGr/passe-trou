"use client";

// Sorted bar list per direction.md §5: 64px row pitch, a label line (name + 12px muted share),
// then a 10px pill bar in --chart-1 with NO track, the mono value 5px after the bar's end.
// Widths are measured from data (longest bar ≈ 88% of the width left after the widest value
// label), never CSS guesswork. Max `maxRows` rows + a "+N more" muted line.

import { useLayoutEffect, useRef, useState } from "react";
import { fmtShare, type RankedRow } from "@/lib/analytics";

export function BarList({
  rows,
  formatValue,
  maxRows = 8,
  ariaLabel = "Bar list",
}: {
  rows: RankedRow[];
  formatValue: (v: number) => string;
  maxRows?: number;
  ariaLabel?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = rows.slice(0, maxRows);
  const more = rows.length - shown.length;
  const maxV = Math.max(0, ...shown.map((r) => r.value ?? 0));
  // Reserve the widest formatted value + the 5px gap; mono ≈ 8px per char at 13px.
  const valReserve = Math.max(3, ...shown.map((r) => formatValue(r.value ?? 0).length)) * 8 + 6;
  const track = Math.max(40, width - valReserve);
  const barPx = (v: number) => (maxV > 0 ? Math.max(2, (v / maxV) * 0.88 * track) : 0);

  return (
    <div ref={hostRef} role="list" aria-label={ariaLabel} className="min-h-[64px]">
      {width > 0 &&
        shown.map((r) => (
          <div key={r.id} role="listitem" className="flex h-16 flex-col justify-center gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-body text-text" title={r.name}>
                {r.name}
              </span>
              <span className="shrink-0 font-mono text-small text-muted">
                {fmtShare(r.share)}
              </span>
            </div>
            <div className="flex items-center">
              {r.value === null ? (
                <span className="text-sm text-muted">–</span>
              ) : (
                <>
                  <div
                    className="h-2.5 shrink-0 rounded-full bg-chart-1"
                    style={{ width: barPx(r.value) }}
                  />
                  <span className="ml-[5px] whitespace-nowrap font-mono text-body tabular-nums">
                    {formatValue(r.value)}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      {width > 0 && more > 0 && <p className="mt-2 text-body text-muted">+{more} more</p>}
    </div>
  );
}
