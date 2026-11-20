import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { ApiKey } from "../generated/prisma/client.ts";
import { generateApiKey } from "../lib/crypto.ts";

const createSchema = z.object({
  label: z.string().trim().min(1),
  enabled: z.boolean().default(true),
});

const patchSchema = z
  .object({
    label: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .partial();

const allowlistSchema = z.object({
  modelIds: z.array(z.string().min(1)),
});

async function allowedModelsJson(db: Db, keyId: string) {
  const rows = await db.apiKeyModel.findMany({
    where: { keyId },
    include: { model: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.model.id, displayName: r.model.name }));
}

/** Public key shape: prefix for display, hash stays in the DB, plaintext never. */
function keyJson(k: ApiKey) {
  return {
    id: k.id,
    keyPrefix: k.prefix,
    label: k.label,
    enabled: k.enabled,
    createdAt: k.createdAt.toISOString(),
  };
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "request body must be valid JSON");
  }
}

async function mustGetMember(db: Db, id: string) {
  const member = await db.member.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "not_found", "member not found");
  return member;
}

async function mustGetKey(db: Db, id: string): Promise<ApiKey> {
  const key = await db.apiKey.findUnique({ where: { id } });
  if (!key) throw new ApiError(404, "not_found", "key not found");
  return key;
}

export function keysRouter(db: Db) {
  const r = new Hono();

  // Nested under members.
  r.post("/members/:id/keys", async (c) => {
    const member = await mustGetMember(db, c.req.param("id"));
    const body = createSchema.parse(await parseJson(c));
    const { token, keyPrefix, keyHash } = generateApiKey();
    const key = await db.apiKey.create({
      data: {
        memberId: member.id,
        label: body.label,
        prefix: keyPrefix,
        sha256: keyHash,
        enabled: body.enabled,
      },
    });
    // Only response that ever carries the plaintext token.
    return c.json({ ...keyJson(key), token }, 201);
  });

  r.get("/members/:id/keys", async (c) => {
    const member = await mustGetMember(db, c.req.param("id"));
    const keys = await db.apiKey.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "asc" },
    });
    return c.json(keys.map(keyJson));
  });

  // Flat key routes.
  r.get("/keys/:id", async (c) => {
    return c.json(keyJson(await mustGetKey(db, c.req.param("id"))));
  });

  r.patch("/keys/:id", async (c) => {
    const key = await mustGetKey(db, c.req.param("id"));
    const body = patchSchema.parse(await parseJson(c));
    const updated = await db.apiKey.update({
      where: { id: key.id },
      data: {
        ...(body.label ? { label: body.label } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
    });
    return c.json(keyJson(updated));
  });

  r.delete("/keys/:id", async (c) => {
    const key = await mustGetKey(db, c.req.param("id"));
    await db.apiKey.delete({ where: { id: key.id } });
    return c.body(null, 204);
  });

  /**
   * Per-key model allowlist (full replace).
   * Semantics: an EMPTY allowlist is a wildcard — every enabled logical model
   * is allowed; a NON-EMPTY allowlist restricts the key to exactly those
   * models. The proxy enforces this; here it is only stored.
   */
  r.put("/keys/:id/models", async (c) => {
    const key = await mustGetKey(db, c.req.param("id"));
    const body = allowlistSchema.parse(await parseJson(c));
    const modelIds = [...new Set(body.modelIds)];
    const found = await db.model.findMany({ where: { id: { in: modelIds } } });
    if (found.length !== modelIds.length) {
      const known = new Set(found.map((m) => m.id));
      const unknown = modelIds.filter((id) => !known.has(id));
      throw new ApiError(400, "invalid_request", `unknown model ids: ${unknown.join(", ")}`);
    }
    await db.$transaction([
      db.apiKeyModel.deleteMany({ where: { keyId: key.id } }),
      db.apiKeyModel.createMany({
        data: modelIds.map((modelId) => ({ keyId: key.id, modelId })),
      }),
    ]);
    return c.json(await allowedModelsJson(db, key.id));
  });

  r.get("/keys/:id/models", async (c) => {
    const key = await mustGetKey(db, c.req.param("id"));
    return c.json(await allowedModelsJson(db, key.id));
  });

  return r;
}
