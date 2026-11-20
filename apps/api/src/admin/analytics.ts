import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { Prisma } from "../generated/prisma/client.ts";

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 datetime");

const querySchema = z.object({
  metric: z.enum(["requests", "tokens", "cost", "latency"]).default("requests"),
  bucket: z.enum(["hour", "day"]).default("hour"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  groupBy: z.enum(["provider", "account", "model", "key", "member"]).optional(),
});

type GroupBy = "provider" | "account" | "model" | "key" | "member";

/** SQL group expressions keyed by validated groupBy; never user input. */
const GROUP_SQL: Record<GroupBy, { expr: string; joinAccounts: boolean }> = {
  provider: { expr: 'a."providerId"', joinAccounts: true },
  account: { expr: 'r."accountId"', joinAccounts: false },
  model: { expr: 'r."modelId"', joinAccounts: false },
  key: { expr: 'r."keyId"', joinAccounts: false },
  member: { expr: 'r."memberId"', joinAccounts: false },
};

interface AggRow {
  bucket: Date;
  gkey: string | null;
  n: bigint | number;
  tokens: bigint | number;
  cost: number;
  avg_latency: number | null;
  p95: number | null;
}

/**
 * GET /admin/analytics/timeseries — metrics-only bucketed series built with
 * one raw query: generate_series provides the zero-filled UTC bucket grid
 * (aligned by date_trunc), aggregated Request rows LEFT JOIN onto it
 * (grouped flavor adds a group key column). Label resolution runs as one
 * findMany per entity type afterwards. Metrics only — no content exists.
 */
export function analyticsRouter(db: Db) {
  const r = new Hono();

  r.get("/analytics/timeseries", async (c) => {
    const q = querySchema.parse({
      metric: c.req.query("metric"),
      bucket: c.req.query("bucket"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      groupBy: c.req.query("groupBy"),
    });

    const now = new Date();
    const from = q.from ? new Date(q.from) : new Date(now.getTime() - (q.bucket === "hour" ? 24 : 30 * 24) * 3600_000);
    const to = q.to ? new Date(q.to) : now;
    if (from.getTime() >= to.getTime()) {
      throw new ApiError(400, "invalid_request", "`from` must be before `to`");
    }
    // Cap the bucket grid: one generate_series row per bucket, one JSON point
    // per bucket per series — an unbounded window is an OOM footgun.
    const unitMs = q.bucket === "hour" ? 3_600_000 : 86_400_000;
    if (Math.floor((to.getTime() - from.getTime()) / unitMs) + 2 > 10_000) {
      throw new ApiError(400, "invalid_request", "window too large: > 10000 buckets");
    }

    const unit = q.bucket;
    const step = q.bucket === "hour" ? "1 hour" : "1 day";

    // SET LOCAL pins the bucket grid to UTC regardless of the pooled
    // connection's session TimeZone.
    let rows: AggRow[];
    if (q.groupBy) {
      const g = GROUP_SQL[q.groupBy];
      const join = g.joinAccounts ? Prisma.raw('LEFT JOIN "accounts" a ON a.id = r."accountId"') : Prisma.empty;
      [, rows] = await db.$transaction([
        db.$executeRaw`SET LOCAL TIME ZONE 'UTC'`,
        db.$queryRaw<AggRow[]>`
        WITH buckets AS (
          SELECT generate_series(date_trunc(${unit}, ${from}::timestamptz), date_trunc(${unit}, ${to}::timestamptz), ${step}::interval) AS bucket
        ), agg AS (
          SELECT date_trunc(${unit}, r.ts) AS bucket, ${Prisma.raw(g.expr)} AS gkey,
                 count(*)::bigint AS n,
                 sum(coalesce(r."promptTokens", 0)::bigint + coalesce(r."completionTokens", 0)::bigint)::bigint AS tokens,
                 round(sum(r."costUsd")::numeric, 6)::float8 AS cost,
                 avg(r."latencyMs")::float8 AS avg_latency,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY r."latencyMs")::float8 AS p95
          FROM "requests" r ${join}
          WHERE r.ts >= ${from} AND r.ts <= ${to}
          GROUP BY 1, 2
        )
        SELECT b.bucket, a.gkey,
               coalesce(a.n, 0)::bigint AS n,
               coalesce(a.tokens, 0)::bigint AS tokens,
               coalesce(a.cost, 0)::float8 AS cost,
               a.avg_latency, a.p95
        FROM buckets b LEFT JOIN agg a ON a.bucket = b.bucket
        ORDER BY b.bucket ASC`,
      ]);
    } else {
      [, rows] = await db.$transaction([
        db.$executeRaw`SET LOCAL TIME ZONE 'UTC'`,
        db.$queryRaw<AggRow[]>`
        WITH buckets AS (
          SELECT generate_series(date_trunc(${unit}, ${from}::timestamptz), date_trunc(${unit}, ${to}::timestamptz), ${step}::interval) AS bucket
        ), agg AS (
          SELECT date_trunc(${unit}, r.ts) AS bucket,
                 count(*)::bigint AS n,
                 sum(coalesce(r."promptTokens", 0)::bigint + coalesce(r."completionTokens", 0)::bigint)::bigint AS tokens,
                 round(sum(r."costUsd")::numeric, 6)::float8 AS cost,
                 avg(r."latencyMs")::float8 AS avg_latency,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY r."latencyMs")::float8 AS p95
          FROM "requests" r
          WHERE r.ts >= ${from} AND r.ts <= ${to}
          GROUP BY 1
        )
        SELECT b.bucket, NULL AS gkey,
               coalesce(a.n, 0)::bigint AS n,
               coalesce(a.tokens, 0)::bigint AS tokens,
               coalesce(a.cost, 0)::float8 AS cost,
               a.avg_latency, a.p95
        FROM buckets b LEFT JOIN agg a ON a.bucket = b.bucket
        ORDER BY b.bucket ASC`,
      ]);
    }

    // Collect the group keys that actually have rows (n>0 with a null gkey =
    // SetNull'd FK rows, bucketed under "none").
    const keysInWindow: (string | null)[] = [];
    if (q.groupBy) {
      const seen = new Set<string | null>();
      for (const row of rows) {
        if (row.n > 0 && !seen.has(row.gkey)) {
          seen.add(row.gkey);
          keysInWindow.push(row.gkey);
        }
      }
    }

    const labels = q.groupBy ? await resolveLabels(db, q.groupBy, keysInWindow) : new Map<string, string>();

    // Assemble series keyed by group ("all" when ungrouped).
    const seriesMap = new Map<string, { key: string; label: string | null; total: number; points: unknown[] }>();
    if (!q.groupBy) seriesMap.set("all", { key: "all", label: null, total: 0, points: [] });
    else {
      for (const gkey of keysInWindow) {
        const key = gkey ?? "none";
        seriesMap.set(key, { key, label: gkey === null ? null : (labels.get(gkey) ?? null), total: 0, points: [] });
      }
    }

    // Bucket grid: unique bucket timestamps in ascending order (grouped
    // queries return one row per bucket per populated group).
    const bucketTimes: string[] = [];
    const byBucket = new Map<string, Map<string | null, AggRow>>();
    for (const row of rows) {
      const ts = row.bucket.toISOString();
      let entries = byBucket.get(ts);
      if (!entries) {
        entries = new Map();
        byBucket.set(ts, entries);
        bucketTimes.push(ts);
      }
      if (row.n > 0) entries.set(row.gkey, row);
    }

    for (const ts of bucketTimes) {
      const entries = byBucket.get(ts)!;
      if (!q.groupBy) {
        const row = entries.get(null);
        const point = makePoint(q.metric, ts, row);
        const s = seriesMap.get("all")!;
        s.points.push(point);
        addTotal(s, q.metric, point);
        continue;
      }
      for (const s of seriesMap.values()) {
        const row = s.key === "none" ? entries.get(null) : entries.get(s.key);
        const point = makePoint(q.metric, ts, row);
        s.points.push(point);
        addTotal(s, q.metric, point);
      }
    }

    const series = [...seriesMap.values()]
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
      .slice(0, 25)
      .map(({ key, label, points }) => ({ key, label, points }));

    return c.json({ from: from.toISOString(), to: to.toISOString(), bucket: q.bucket, metric: q.metric, series });
  });

  return r;
}

/** Point for one bucket; `row` undefined = empty bucket (zero / null-latency). */
function makePoint(metric: string, ts: string, row: AggRow | undefined | null): unknown {
  if (metric === "latency") {
    return { ts, avg: row?.avg_latency ?? null, p95: row?.p95 ?? null };
  }
  const value =
    metric === "requests"
      ? Number(row?.n ?? 0)
      : metric === "tokens"
        ? Number(row?.tokens ?? 0)
        : (row?.cost ?? 0);
  return { ts, value };
}

function addTotal(s: { total: number }, metric: string, point: unknown): void {
  const p = point as { value?: number; avg?: number | null };
  s.total += metric === "latency" ? (p.avg ?? 0) : (p.value ?? 0);
}

async function resolveLabels(db: Db, groupBy: GroupBy, ids: (string | null)[]): Promise<Map<string, string>> {
  const realIds = ids.filter((x): x is string => x !== null);
  const map = new Map<string, string>();
  if (realIds.length === 0) return map;
  switch (groupBy) {
    case "provider": {
      for (const p of await db.provider.findMany({ where: { id: { in: realIds } } })) map.set(p.id, p.name);
      break;
    }
    case "account": {
      for (const a of await db.account.findMany({ where: { id: { in: realIds } } })) map.set(a.id, a.label);
      break;
    }
    case "model": {
      for (const m of await db.model.findMany({ where: { id: { in: realIds } } })) map.set(m.id, m.name);
      break;
    }
    case "key": {
      for (const k of await db.apiKey.findMany({ where: { id: { in: realIds } } })) map.set(k.id, `${k.prefix} ${k.label}`);
      break;
    }
    case "member": {
      for (const m of await db.member.findMany({ where: { id: { in: realIds } } })) map.set(m.id, m.name);
      break;
    }
  }
  return map;
}
