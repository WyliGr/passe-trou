import { Hono } from "hono";
import { feedBus, type FeedRow } from "../lib/feedBus.ts";

/**
 * GET /admin/analytics/feed — live SSE stream of persisted request rows
 * (M2-T3). Read-only: replays nothing, touches no DB. Clients backfill via
 * GET /admin/requests. Heartbeat comment every heartbeatMs so intermediaries
 * don't idle-cut; unsubscribe + heartbeat stop on client disconnect.
 */

export interface AnalyticsFeedOptions {
  /** Heartbeat interval in ms (tests inject a short one). */
  heartbeatMs?: number | undefined;
}

/** Spec order — SSE data JSON keeps exactly these keys in this order. */
function feedPayload(row: FeedRow): Record<string, unknown> {
  return {
    id: row.id,
    ts: row.ts,
    requestedModel: row.requestedModel,
    upstreamModel: row.upstreamModel,
    wireFormat: row.wireFormat,
    stream: row.stream,
    status: row.status,
    httpStatus: row.httpStatus,
    latencyMs: row.latencyMs,
    ttftMs: row.ttftMs,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    costUsd: row.costUsd,
    keyId: row.keyId,
    memberId: row.memberId,
    accountId: row.accountId,
    modelId: row.modelId,
  };
}

export function analyticsRouter(opts: AnalyticsFeedOptions = {}) {
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const r = new Hono();

  r.get("/analytics/feed", (c) => {
    const encoder = new TextEncoder();
    let listener!: (row: FeedRow) => void;
    let heartbeat!: ReturnType<typeof setInterval>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string): void => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // client already gone; cancel() does the cleanup
          }
        };
        send(`event: hello\ndata: ${JSON.stringify({ ok: true, ts: new Date().toISOString() })}\n\n`);
        listener = (row) => {
          send(`event: request\ndata: ${JSON.stringify(feedPayload(row))}\n\n`);
        };
        feedBus.subscribe(listener);
        heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);
        heartbeat.unref?.();
      },
      cancel() {
        clearInterval(heartbeat);
        feedBus.unsubscribe(listener);
      },
    });

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return c.body(stream);
  });

  return r;
}
