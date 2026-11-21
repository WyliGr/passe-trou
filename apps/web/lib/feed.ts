"use client";

// Live feed client for GET /admin/analytics/feed (SSE). The pt_session cookie
// is sent automatically (same-origin via /api) — no Authorization header, so
// the wire events are consumed over fetch() + a manual SSE parse (same event
// names, same payloads), with the briefed backoff 1s → 2s → 5s → 15s.

import type { FeedRow } from "@/lib/requests";

export type FeedState = "connecting" | "live" | "reconnecting";

export interface FeedHandlers {
  onHello?: (ts: string) => void;
  onRequest?: (row: FeedRow) => void;
  onState?: (state: FeedState) => void;
}

export interface FeedHandle {
  close: () => void;
}

const BACKOFF_MS = [1000, 2000, 5000, 15000];
const BACKOFF_CAP_MS = 15000;

/** Minimal SSE block parser: yields {event, data} per blank-line-terminated block. */
function* parseBlocks(buffer: string): Generator<{ event: string; data: string }> {
  for (const block of buffer.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue; // heartbeat comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) yield { event, data: dataLines.join("\n") };
  }
}

/**
 * Connect to the feed. Reconnects forever with backoff until close().
 * onState announces connecting (first attempt), live (hello received or an
 * event flowing), reconnecting (any drop, with retry scheduled).
 */
export function connectFeed(handlers: FeedHandlers): FeedHandle {
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  let gotHello = false;

  const scheduleRetry = () => {
    if (closed) return;
    handlers.onState?.("reconnecting");
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? BACKOFF_CAP_MS;
    attempt += 1;
    retryTimer = setTimeout(() => void run(), wait);
  };

  const run = async () => {
    if (closed) return;
    gotHello = false;
    handlers.onState?.(attempt === 0 ? "connecting" : "reconnecting");
    abort = new AbortController();
    try {
      const res = await fetch("/api/admin/analytics/feed", {
        signal: abort.signal,
        cache: "no-store",
      });
      if (res.status === 401) {
        // Session gone (logout or expiry) — bounce like every other admin call.
        window.location.assign("/login");
        return;
      }
      if (!res.ok || !res.body) throw new Error(`feed http_${res.status}`);
      attempt = 0; // a live response resets the backoff ladder
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const cut = buffer.lastIndexOf("\n\n");
        if (cut === -1) continue;
        const ready = buffer.slice(0, cut + 2);
        buffer = buffer.slice(cut + 2);
        for (const block of parseBlocks(ready)) {
          if (block.event === "hello") {
            gotHello = true;
            handlers.onState?.("live");
            try {
              handlers.onHello?.((JSON.parse(block.data) as { ts: string }).ts);
            } catch {
              // malformed hello — still counts as live
            }
          } else if (block.event === "request") {
            if (!gotHello) handlers.onState?.("live");
            gotHello = true;
            try {
              handlers.onRequest?.(JSON.parse(block.data) as FeedRow);
            } catch {
              // one malformed event must not kill the stream
            }
          }
        }
      }
    } catch {
      // aborted (close) or network drop — the close flag decides
    }
    if (!closed) scheduleRetry();
  };

  void run();
  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      abort?.abort();
    },
  };
}
