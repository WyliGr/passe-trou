import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { Account } from "../generated/prisma/client.ts";

const createSchema = z.object({
  displayName: z.string().trim().min(1),
  status: z.enum(["active", "benched"]).default("active"),
});

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1),
    status: z.enum(["active", "benched"]),
  })
  .partial();

type AccountWithCredential = Account & { credential: { keyPrefix: string } | null };

/** Public account shape: never includes ciphertext or key material, only keyPrefix. */
function accountJson(a: AccountWithCredential) {
  return {
    id: a.id,
    providerId: a.providerId,
    displayName: a.label,
    status: a.enabled ? "active" : "benched",
    keyPrefix: a.credential?.keyPrefix ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

const WITH_CREDENTIAL_PREFIX = { credential: { select: { keyPrefix: true } } };

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "request body must be valid JSON");
  }
}

async function mustGetAccount(db: Db, id: string) {
  const account = await db.account.findUnique({ where: { id }, include: WITH_CREDENTIAL_PREFIX });
  if (!account) throw new ApiError(404, "not_found", "account not found");
  return account;
}

async function assertLabelFree(db: Db, providerId: string, displayName: string, excludeId?: string) {
  const clash = await db.account.findFirst({
    where: { providerId, label: displayName, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) {
    throw new ApiError(409, "duplicate_display_name", "displayName already in use on this provider");
  }
}

export function accountsRouter(db: Db) {
  const r = new Hono();

  // Nested under providers.
  r.post("/providers/:id/accounts", async (c) => {
    const providerId = c.req.param("id");
    const provider = await db.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new ApiError(404, "not_found", "provider not found");
    const body = createSchema.parse(await parseJson(c));
    await assertLabelFree(db, providerId, body.displayName);
    const account = await db.account.create({
      data: {
        providerId,
        label: body.displayName,
        enabled: body.status === "active",
      },
      include: WITH_CREDENTIAL_PREFIX,
    });
    return c.json(accountJson(account), 201);
  });

  r.get("/providers/:id/accounts", async (c) => {
    const providerId = c.req.param("id");
    const provider = await db.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new ApiError(404, "not_found", "provider not found");
    const accounts = await db.account.findMany({
      where: { providerId },
      orderBy: { createdAt: "asc" },
      include: WITH_CREDENTIAL_PREFIX,
    });
    return c.json(accounts.map(accountJson));
  });

  // Flat account routes.
  r.get("/accounts/:id", async (c) => {
    return c.json(accountJson(await mustGetAccount(db, c.req.param("id"))));
  });

  r.patch("/accounts/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await mustGetAccount(db, id);
    const body = patchSchema.parse(await parseJson(c));
    if (body.displayName) await assertLabelFree(db, existing.providerId, body.displayName, id);
    const account = await db.account.update({
      where: { id },
      data: {
        ...(body.displayName ? { label: body.displayName } : {}),
        ...(body.status ? { enabled: body.status === "active" } : {}),
      },
      include: WITH_CREDENTIAL_PREFIX,
    });
    return c.json(accountJson(account));
  });

  r.delete("/accounts/:id", async (c) => {
    const id = c.req.param("id");
    await mustGetAccount(db, id);
    const mappings = await db.modelAccount.count({ where: { accountId: id } });
    if (mappings > 0) {
      throw new ApiError(409, "account_has_mappings", "account still has model mappings");
    }
    await db.account.delete({ where: { id } });
    return c.body(null, 204);
  });

  return r;
}
