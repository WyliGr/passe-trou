import { Hono } from "hono";
import type { Db } from "../db.ts";

/**
 * GET /admin/overview — dashboard landing payload, computed live from
 * Request rows (SQL groupBy/aggregate, no rollup tables in M1).
 * "today" is the UTC midnight boundary; per-account stats come from one
 * groupBy(accountId) over today's rows.
 */
export function overviewRouter(db: Db) {
  const r = new Hono();

  r.get("/overview", async (c) => {
    const now = new Date();
    const midnightUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const [providers, accounts, models, members, keys, today, perAccount, accountRows] =
      await Promise.all([
        db.provider.count(),
        db.account.count(),
        db.model.count(),
        db.member.count(),
        db.apiKey.count(),
        db.request.aggregate({
          where: { ts: { gte: midnightUtc } },
          _count: { _all: true },
          _sum: { promptTokens: true, completionTokens: true, costUsd: true },
        }),
        db.request.groupBy({
          by: ["accountId"],
          where: { ts: { gte: midnightUtc }, accountId: { not: null } },
          _count: { _all: true },
          _sum: { costUsd: true },
        }),
        db.account.findMany({
          orderBy: { createdAt: "asc" },
          include: { provider: true },
        }),
      ]);

    const statsByAccount = new Map(perAccount.map((g) => [g.accountId, g]));

    return c.json({
      counts: { providers, accounts, models, members, keys },
      today: {
        requests: today._count._all,
        tokensIn: today._sum.promptTokens ?? 0,
        tokensOut: today._sum.completionTokens ?? 0,
        costUsd: today._sum.costUsd ?? 0,
      },
      accounts: accountRows.map((a) => {
        const stats = statsByAccount.get(a.id);
        return {
          id: a.id,
          label: a.label,
          provider: a.provider.name,
          enabled: a.enabled,
          cooling: a.cooledDownUntil !== null && a.cooledDownUntil.getTime() > now.getTime(),
          todayRequests: stats?._count._all ?? 0,
          todayCostUsd: stats?._sum.costUsd ?? 0,
        };
      }),
    });
  });

  return r;
}
