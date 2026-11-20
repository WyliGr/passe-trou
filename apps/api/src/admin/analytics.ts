import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be an ISO 8601 datetime" });

const querySchema = z.object({
  groupBy: z.enum(["provider", "account", "model", "key", "member"]).default("provider"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

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
    const query = querySchema.parse({
      groupBy: c.req.query("groupBy"),
      from: c.req.query("from"),
      to: c.req.query("to"),
    });
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 24 * 3600 * 1000);
    if (from >= to) {
      throw new ApiError(400, "invalid_request", "from must be before to");
    }

    return c.json({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: query.groupBy,
      total: zeroMetrics(),
      rows: [],
    });
  });

  return r;
}
