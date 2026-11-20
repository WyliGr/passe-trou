import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { Price } from "../generated/prisma/client.ts";

const entrySchema = z.object({
  id: z.string().min(1).optional(),
  scope: z.enum(["provider", "account"]),
  providerId: z.string().min(1).nullish(),
  accountId: z.string().min(1).nullish(),
  modelMatcher: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^*]*\*?$/, "modelMatcher must be an exact name or a glob with a single trailing *"),
  priceInput: z.number().min(0),
  priceOutput: z.number().min(0),
  priceCachedInput: z.number().min(0).nullish(),
});

const putSchema = z.object({ prices: z.array(entrySchema) });

type Entry = z.infer<typeof entrySchema>;

/** Scope/rFK coherence: scope must carry its own id and not the other scope's. */
function assertScopeCoherent(e: Entry): void {
  if (e.scope === "provider") {
    if (!e.providerId || e.accountId) {
      throw new ApiError(400, "invalid_request", "scope=provider requires providerId and forbids accountId");
    }
  } else if (!e.accountId || e.providerId) {
    throw new ApiError(400, "invalid_request", "scope=account requires accountId and forbids providerId");
  }
}

function priceJson(p: Price) {
  return {
    id: p.id,
    scope: p.accountId ? ("account" as const) : ("provider" as const),
    providerId: p.providerId,
    accountId: p.accountId,
    modelMatcher: p.modelMatcher,
    priceInput: p.priceInput,
    priceOutput: p.priceOutput,
    priceCachedInput: p.priceCachedInput,
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "request body must be valid JSON");
  }
}

export function pricesRouter(db: Db) {
  const r = new Hono();

  r.get("/prices", async (c) => {
    const prices = await db.price.findMany({ orderBy: { createdAt: "asc" } });
    return c.json(prices.map(priceJson));
  });

  /**
   * Bulk replace: the submitted list becomes the full price table.
   * Entries carrying an existing `id` are updated in place (stable ids);
   * entries without `id` are created; rows absent from the list are deleted.
   */
  r.put("/prices", async (c) => {
    const body = putSchema.parse(await parseJson(c));
    for (const e of body.prices) assertScopeCoherent(e);

    const withId = body.prices.filter((e) => e.id).map((e) => e.id as string);
    const existing = await db.price.findMany({ where: { id: { in: withId } } });
    if (existing.length !== withId.length) {
      throw new ApiError(404, "not_found", "price not found");
    }

    const providerIds = [...new Set(body.prices.map((e) => e.providerId).filter((v): v is string => !!v))];
    const accountIds = [...new Set(body.prices.map((e) => e.accountId).filter((v): v is string => !!v))];
    const [providers, accounts] = await Promise.all([
      db.provider.findMany({ where: { id: { in: providerIds } } }),
      db.account.findMany({ where: { id: { in: accountIds } } }),
    ]);
    if (providers.length !== providerIds.length || accounts.length !== accountIds.length) {
      throw new ApiError(400, "invalid_request", "unknown providerId or accountId");
    }

    const result = await db.$transaction(async (tx) => {
      await tx.price.deleteMany({ where: { id: { notIn: withId } } });
      const out: Price[] = [];
      for (const e of body.prices) {
        const data = {
          providerId: e.scope === "provider" ? (e.providerId as string) : null,
          accountId: e.scope === "account" ? (e.accountId as string) : null,
          modelMatcher: e.modelMatcher,
          priceInput: e.priceInput,
          priceOutput: e.priceOutput,
          priceCachedInput: e.priceCachedInput ?? null,
        };
        out.push(e.id ? await tx.price.update({ where: { id: e.id }, data }) : await tx.price.create({ data }));
      }
      return out;
    });

    return c.json(result.map(priceJson));
  });

  return r;
}
