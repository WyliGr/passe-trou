import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { Prisma } from "../generated/prisma/client.ts";

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

/** Raw aggregate row as Postgres returns it (int8 → bigint, float8 → number). */
interface RawAgg {
  requests: bigint;
  errors: bigint;
  promptTokens: bigint;
  completionTokens: bigint;
  reasoningTokens: bigint;
  cachedTokens: bigint;
  toolCalls: bigint;
  costUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgTtftMs: number | null;
  p95TtftMs: number | null;
}

type RawGroupRow = RawAgg & { key: string; label: string | null };

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Shape one raw aggregate into the response metrics block. */
function toMetrics(r: RawAgg) {
  const requests = Number(r.requests);
  const errors = Number(r.errors);
  return {
    requests,
    errors,
    errorRate: requests === 0 ? 0 : round(errors / requests, 4),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
    reasoningTokens: Number(r.reasoningTokens),
    cachedTokens: Number(r.cachedTokens),
    toolCalls: Number(r.toolCalls),
    costUsd: round(r.costUsd, 6),
    avgLatencyMs: r.avgLatencyMs,
    p95LatencyMs: r.p95LatencyMs,
    avgTtftMs: r.avgTtftMs,
    p95TtftMs: r.p95TtftMs,
  };
}

/** Shared SELECT list of per-group/total aggregates over the alias r. */
const AGGREGATES = Prisma.sql`
  COUNT(*)::bigint AS requests,
  COUNT(*) FILTER (WHERE r.status = 'error')::bigint AS errors,
  COALESCE(SUM(r."promptTokens"), 0)::bigint AS "promptTokens",
  COALESCE(SUM(r."completionTokens"), 0)::bigint AS "completionTokens",
  COALESCE(SUM(r."reasoningTokens"), 0)::bigint AS "reasoningTokens",
  COALESCE(SUM(r."cachedTokens"), 0)::bigint AS "cachedTokens",
  COALESCE(SUM(r."toolCallCount"), 0)::bigint AS "toolCalls",
  COALESCE(SUM(r."costUsd"), 0)::float8 AS "costUsd",
  AVG(r."latencyMs")::float8 AS "avgLatencyMs",
  percentile_cont(0.95) WITHIN GROUP (ORDER BY r."latencyMs")::float8 AS "p95LatencyMs",
  AVG(r."ttftMs") FILTER (WHERE r."ttftMs" IS NOT NULL)::float8 AS "avgTtftMs",
  percentile_cont(0.95) WITHIN GROUP (ORDER BY r."ttftMs")
    FILTER (WHERE r."ttftMs" IS NOT NULL)::float8 AS "p95TtftMs"`;

interface Axis {
  /** Group key expression; NULL (deleted/never-set FK) collapses to 'none' in SELECT. */
  key: Prisma.Sql;
  /** LEFT JOINs bringing the label row in (labels never filter). */
  join: Prisma.Sql;
  /** Label expression; stays NULL when the FK row or id is gone. */
  label: Prisma.Sql;
}

type GroupBy = z.infer<typeof querySchema>["groupBy"];

/** Axis map keyed by the validated enum — fragments are static SQL, never user input. */
const AXES: Record<GroupBy, Axis> = {
  provider: {
    key: Prisma.sql`a."providerId"`,
    join: Prisma.sql`LEFT JOIN "accounts" a ON a.id = r."accountId"
                     LEFT JOIN "providers" p ON p.id = a."providerId"`,
    label: Prisma.sql`p."name"`,
  },
  account: {
    key: Prisma.sql`r."accountId"`,
    join: Prisma.sql`LEFT JOIN "accounts" a ON a.id = r."accountId"`,
    label: Prisma.sql`a."label"`,
  },
  model: {
    key: Prisma.sql`r."modelId"`,
    join: Prisma.sql`LEFT JOIN "models" m ON m.id = r."modelId"`,
    label: Prisma.sql`m."name"`,
  },
  key: {
    key: Prisma.sql`r."keyId"`,
    join: Prisma.sql`LEFT JOIN "api_keys" k ON k.id = r."keyId"`,
    label: Prisma.sql`concat(k."label", ' (', k."prefix", ')')`,
  },
  member: {
    key: Prisma.sql`r."memberId"`,
    join: Prisma.sql`LEFT JOIN "members" mb ON mb.id = r."memberId"`,
    label: Prisma.sql`mb."name"`,
  },
};

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

    const axis = AXES[query.groupBy];
    const [rawRows, rawTotal] = await Promise.all([
      db.$queryRaw<RawGroupRow[]>(Prisma.sql`
        SELECT COALESCE(${axis.key}::text, 'none') AS key, ${axis.label} AS label, ${AGGREGATES}
        FROM "requests" r
        ${axis.join}
        WHERE r.ts >= ${from} AND r.ts <= ${to}
        GROUP BY 1, 2
        ORDER BY "costUsd" DESC NULLS LAST, "avgLatencyMs" DESC NULLS LAST`),
      db.$queryRaw<RawAgg[]>(Prisma.sql`
        SELECT ${AGGREGATES}
        FROM "requests" r
        WHERE r.ts >= ${from} AND r.ts <= ${to}`),
    ]);

    return c.json({
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: query.groupBy,
      total: rawTotal[0] ? toMetrics(rawTotal[0]) : zeroMetrics(),
      rows: rawRows.map((row) => ({ key: row.key, label: row.label, ...toMetrics(row) })),
    });
  });

  return r;
}
