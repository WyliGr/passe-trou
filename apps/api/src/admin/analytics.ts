import { Hono } from "hono";
import type { Db } from "../db.ts";

/** Zeroed metrics block: no rows in range (or an empty group) collapse to this. */
function zeroMetrics() {
  return {
    requests: 0,
    errors: 0,
    errorRate: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    toolCalls: 0,
    costUsd: 0,
    avgLatencyMs: null,
    p95LatencyMs: null,
    avgTtftMs: null,
    p95TtftMs: null,
  };
}

/**
 * GET /admin/analytics/summary — grouped aggregate metrics over Request rows
 * in [from, to]. Metrics only: no prompt/response content exists or leaves here.
 */
export function analyticsRouter(db: Db) {
  const r = new Hono();

  r.get("/analytics/summary", async (c) => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);

    return c.json({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: "provider",
      total: zeroMetrics(),
      rows: [],
    });
  });

  return r;
}
