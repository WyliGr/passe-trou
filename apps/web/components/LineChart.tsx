"use client";

// Hand-rolled SVG line chart per §6: 3-5 faint horizontal gridlines, right-aligned muted mono y
// labels, dates on x (time scale), one 1.5px --chart-1 series with no legend, crosshair tooltip
// in a --raised card. Zero is always the baseline. Null values break the line (honest gaps).
// Latency metrics pass a second series (p95) at 35% opacity, announced by small legend chips.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtAxisTs, fmtCompact, fmtPointTs } from "@/lib/format";

export interface LinePoint {
  ts: number; // epoch ms
  value: number | null;
}

export interface ChartLegend {
  primary: string;
  secondary: string;
}

// Round ticks (steps of 1, 2, 2.5 or 5 × 10^n) whose top sits above the largest value.
function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  let hi = Math.ceil(max / step) * step;
  if (hi <= max) hi += step;
  const out: number[] = [];
  for (let v = 0; v <= hi + step / 2; v += step) out.push(v);
  return out;
}

/** Path with a gap (new subpath) wherever value is null. */
function makePath(
  points: LinePoint[],
  x: (ts: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.value === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p.ts).toFixed(2)},${y(p.value).toFixed(2)}`;
    pen = true;
  }
  return d;
}

export function LineChart({
  points,
  secondary,
  legend,
  height = 200,
  formatValue = (v) => fmtCompact(v),
  ariaLabel = "Series over time",
}: {
  points: LinePoint[];
  /** Second comparison series (same bucket grid), drawn at 35% opacity. */
  secondary?: LinePoint[];
  /** Chips labelling the two series; required when secondary is passed. */
  legend?: ChartLegend;
  height?: number;
  formatValue?: (v: number) => string;
  ariaLabel?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 8, right: 10, bottom: 26, left: 44 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);

  const geom = useMemo(() => {
    if (points.length === 0) return null;
    const all = secondary ? [...points, ...secondary] : points;
    const t0 = Math.min(...all.map((p) => p.ts));
    const t1 = Math.max(...all.map((p) => p.ts));
    const span = Math.max(t1 - t0, 1);
    const vmax = Math.max(0, ...all.map((p) => p.value ?? 0));
    const ticks = niceTicks(vmax);
    const top = ticks[ticks.length - 1] ?? 1;
    const x = (ts: number) => pad.left + ((ts - t0) / span) * plotW;
    const y = (v: number) => pad.top + plotH - (v / top) * plotH;
    const path = makePath(points, x, y);
    const path2 = secondary ? makePath(secondary, x, y) : null;
    // 4-6 x labels on one step, ends pulled inside the plot
    const wanted = width > 560 ? 6 : 4;
    const xl: { ts: number; anchor: "start" | "middle" | "end" }[] = [];
    for (let i = 0; i < wanted; i++) {
      const ts = t0 + (span * i) / (wanted - 1);
      xl.push({
        ts,
        anchor: i === 0 ? "start" : i === wanted - 1 ? "end" : "middle",
      });
    }
    return { t0, t1, span, ticks, top, x, y, path, path2, xl };
  }, [points, secondary, plotW, plotH, width, pad.left, pad.top]);

  if (points.length === 0) return <div ref={hostRef} style={{ height }} />;

  const px = (i: number) => geom!.x(points[i]!.ts);
  const hoverPt = hover !== null ? points[hover]! : null;
  const hoverSec =
    hover !== null && secondary?.[hover] && secondary[hover]!.ts === hoverPt?.ts
      ? secondary[hover]!
      : null;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!geom) return;
    const rect = hostRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geom.x(p.ts) - mx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div>
      {secondary && legend && (
        <div className="mb-2 flex items-center gap-4">
          {[legend.primary, legend.secondary].map((label, i) => (
            <span key={label} className="flex items-center gap-1.5 text-small text-muted">
              <span
                aria-hidden="true"
                className="inline-block h-[2px] w-4 bg-chart-1"
                style={i === 1 ? { opacity: 0.35 } : undefined}
              />
              {label}
            </span>
          ))}
        </div>
      )}
      <div
        ref={hostRef}
        className="relative"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {width > 0 && geom && (
          <svg width={width} height={height} className="block overflow-visible">
            {geom.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={geom.y(t)}
                  y2={geom.y(t)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={pad.left - 8}
                  y={geom.y(t) + 3}
                  textAnchor="end"
                  fill="var(--muted)"
                  fontSize="12"
                  className="font-mono"
                >
                  {formatValue(t)}
                </text>
              </g>
            ))}
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotH}
              y2={pad.top + plotH}
              stroke="var(--control)"
              strokeWidth="1"
            />
            {geom.xl.map((l) => (
              <text
                key={l.ts}
                x={l.anchor === "start" ? pad.left : l.anchor === "end" ? width - pad.right : geom.x(l.ts)}
                y={height - 8}
                textAnchor={l.anchor}
                fill="var(--muted)"
                fontSize="12"
                className="font-mono"
              >
                {fmtAxisTs(l.ts, geom.span)}
              </text>
            ))}
            {geom.path2 && (
              <path
                d={geom.path2}
                fill="none"
                stroke="var(--chart-1)"
                strokeOpacity="0.35"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            <path
              d={geom.path}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.length === 1 && points[0]!.value !== null && (
              <circle cx={geom.x(points[0]!.ts)} cy={geom.y(points[0]!.value!)} r="3.5" fill="var(--chart-1)" />
            )}
            {hover !== null && hoverPt && (
              <g pointerEvents="none">
                <line
                  x1={px(hover)}
                  x2={px(hover)}
                  y1={pad.top}
                  y2={pad.top + plotH}
                  stroke="var(--control)"
                  strokeWidth="1"
                />
                {hoverPt.value !== null && (
                  <circle
                    cx={px(hover)}
                    cy={geom.y(hoverPt.value)}
                    r="3.5"
                    fill="var(--chart-1)"
                    stroke="var(--surface)"
                    strokeWidth="1.5"
                  />
                )}
                {hoverSec && hoverSec.value !== null && (
                  <circle
                    cx={px(hover)}
                    cy={geom.y(hoverSec.value)}
                    r="3.5"
                    fill="var(--chart-1)"
                    fillOpacity="0.35"
                    stroke="var(--surface)"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )}
          </svg>
        )}
        {hover !== null && hoverPt && (
          <div
            className="pointer-events-none absolute z-10 rounded-card bg-raised px-2 py-1 text-small shadow-card"
            style={{
              left: Math.min(Math.max(px(hover) - 60, 0), Math.max(width - 140, 0)),
              top: 0,
            }}
          >
            <span className="font-mono text-muted">{fmtPointTs(hoverPt.ts, geom!.span)}</span>
            <span className="mx-2 text-rule">·</span>
            <span className="font-mono text-text">
              {hoverPt.value === null ? "–" : formatValue(hoverPt.value)}
            </span>
            {hoverSec && legend && (
              <>
                <span className="mx-2 text-rule">·</span>
                <span className="text-muted">{legend.secondary}</span>{" "}
                <span className="font-mono text-text">
                  {hoverSec.value === null ? "–" : formatValue(hoverSec.value)}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
