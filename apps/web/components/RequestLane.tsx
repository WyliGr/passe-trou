"use client";

// Request lane — the console's signature element (DESIGN.md): one 6px dot per
// request across the last 60 minutes, status-encoded, fed live by the SSE
// feed (backfilled from /admin/requests so it is never empty on mount).
// Click-through to /requests. Unmount closes the feed.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { connectFeed, type FeedState } from "@/lib/feed";
import type { RequestRow, RequestsPage } from "@/lib/requests";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Skeleton } from "@/components/Skeleton";

export interface LaneEvent {
  id: string;
  ts: number; // epoch ms
  status: "ok" | "error" | "aborted";
  /** Arrived over the live feed → 120ms fade/slide entrance. */
  fresh?: boolean;
}

const WINDOW_MS = 60 * 60 * 1000;
const DOT = 6;
const STACK_STEP = 8;
const STACK_MAX = 6;

function laneStatus(s: string): LaneEvent["status"] {
  return s === "error" || s === "aborted" ? s : "ok";
}

function dotFill(status: LaneEvent["status"]): { fill: string; opacity?: number } {
  if (status === "error") return { fill: "var(--color-error)" };
  if (status === "aborted") return { fill: "var(--color-warning)" };
  return { fill: "var(--color-primary)", opacity: 0.4 };
}

type Backfill =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok" };

export function RequestLane({
  fixtures,
}: {
  /** Dev-harness only: render these events with this feed state, no network. */
  fixtures?: { events: LaneEvent[]; feedState?: FeedState };
}) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [events, setEvents] = useState<LaneEvent[]>(fixtures?.events ?? []);
  const [feedState, setFeedState] = useState<FeedState>(fixtures?.feedState ?? "connecting");
  const [backfill, setBackfill] = useState<Backfill>(
    fixtures ? { status: "ok" } : { status: "loading" },
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The window is anchored to now; a slow tick keeps positions and axis honest.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (fixtures) return;
    let cancelled = false;
    let feed: { close: () => void } | null = null;

    const backfillThenConnect = async () => {
      setBackfill({ status: "loading" });
      try {
        const page = await apiFetch<RequestsPage>("/admin/requests?limit=50");
        if (cancelled) return;
        setBackfill({ status: "ok" });
        setEvents(page.rows.map((r: RequestRow) => ({
          id: r.id,
          ts: Date.parse(r.ts),
          status: laneStatus(r.status),
        })));
      } catch (error) {
        if (!cancelled) setBackfill({ status: "error", error });
      }
      if (cancelled) return;
      feed = connectFeed({
        onState: (s) => setFeedState(s),
        onRequest: (row) =>
          setEvents((prev) => [
            ...prev.slice(-499),
            {
              id: row.id,
              ts: Date.parse(row.ts),
              status: laneStatus(row.status),
              fresh: true,
            },
          ]),
      });
    };
    void backfillThenConnect();

    return () => {
      cancelled = true;
      feed?.close();
    };
    // fixtures/static: harness renders need no effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = nowMs - WINDOW_MS;
  const placed = useMemo(() => {
    const inWindow = events.filter((e) => e.ts >= start && e.ts <= nowMs);
    // Stack dots that fall inside the same minute slot, bottom first.
    const perSlot = new Map<number, number>();
    return inWindow.map((e) => {
      const slot = Math.floor((e.ts - start) / 60_000);
      const idx = Math.min(perSlot.get(slot) ?? 0, STACK_MAX);
      perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
      return { ...e, x: ((e.ts - start) / WINDOW_MS) * width, y: idx * STACK_STEP };
    });
  }, [events, start, nowMs, width]);

  const stripHeight = STACK_MAX * STACK_STEP + DOT;
  const stateLabel =
    feedState === "live" ? "live" : feedState === "connecting" ? "connecting…" : "reconnecting…";

  return (
    <section aria-label="Request lane, last 60 minutes" className="rounded-lg bg-surface p-6">      <div className="mb-3 flex items-center justify-between">
        <h2 className="h2">Request lane</h2>
        <span className="flex items-center gap-1.5 text-small text-secondary">
          {feedState === "live" && (
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          )}
          {stateLabel}
        </span>
      </div>
      {backfill.status === "loading" ? (
        <Skeleton className="h-[72px] w-full" />
      ) : backfill.status === "error" ? (
        <ErrorBlock error={backfill.error} />
      ) : placed.length === 0 ? (
        <Empty sentence="No requests in the last hour — send traffic to the proxy and the lane lights up." />
      ) : (
        <button
          type="button"
          onClick={() => router.push("/requests")}
          aria-label="Open the requests screen"
          className="block w-full cursor-pointer text-left"
        >
          <div ref={hostRef} className="h-[72px]">
            {width > 0 && (
              <svg width={width} height={72} className="block" aria-hidden="true">
                <line
                  x1="0"
                  x2={width}
                  y1={stripHeight + 4}
                  y2={stripHeight + 4}
                  stroke="var(--color-border)"
                  strokeWidth="1"
                />
                {placed.map((e) => {
                  const { fill, opacity } = dotFill(e.status);
                  return (
                    <circle
                      key={e.id}
                      cx={Math.min(Math.max(e.x, DOT / 2), width - DOT / 2)}
                      cy={stripHeight - DOT / 2 - e.y}
                      r={DOT / 2}
                      fill={fill}
                      opacity={opacity}
                      className={e.fresh ? "lane-dot-in" : undefined}
                    />
                  );
                })}
              </svg>
            )}
            <div className="mt-1 flex justify-between font-mono text-small text-secondary">
              <span>-60m</span>
              <span>-30m</span>
              <span>now</span>
            </div>
          </div>
        </button>
      )}
    </section>
  );
}
