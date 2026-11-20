import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { Provider, ProviderKind } from "../generated/prisma/client.ts";

const baseUrlSchema = z.url().refine(
  (u) => u.startsWith("https://") || u.startsWith("http://"),
  "baseUrl must be an http(s) URL",
);

const createSchema = z.object({
  displayName: z.string().trim().min(1),
  type: z.enum(["openai-compatible", "anthropic-compatible"]),
  baseUrl: baseUrlSchema,
});

const patchSchema = createSchema.partial();

/** API type ↔ DB enum. */
const TYPE_TO_KIND: Record<"openai-compatible" | "anthropic-compatible", ProviderKind> = {
  "openai-compatible": "openai",
  "anthropic-compatible": "anthropic",
};

function providerJson(p: Provider) {
  return {
    id: p.id,
    displayName: p.name,
    type: p.kind === "openai" ? "openai-compatible" : "anthropic-compatible",
    baseUrl: p.baseUrl,
    createdAt: p.createdAt.toISOString(),
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

async function mustGetProvider(db: Db, id: string): Promise<Provider> {
  const provider = await db.provider.findUnique({ where: { id } });
  if (!provider) throw new ApiError(404, "not_found", "provider not found");
  return provider;
}

async function assertNameFree(db: Db, displayName: string, excludeId?: string) {
  const clash = await db.provider.findFirst({
    where: { name: displayName, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ApiError(409, "duplicate_display_name", "displayName already in use");
}

export function providersRouter(db: Db) {
  const r = new Hono();

  r.post("/providers", async (c) => {
    const body = createSchema.parse(await parseJson(c));
    await assertNameFree(db, body.displayName);
    const provider = await db.provider.create({
      data: {
        name: body.displayName,
        kind: TYPE_TO_KIND[body.type],
        baseUrl: body.baseUrl,
      },
    });
    return c.json(providerJson(provider), 201);
  });

  r.get("/providers", async (c) => {
    const providers = await db.provider.findMany({ orderBy: { createdAt: "asc" } });
    return c.json(providers.map(providerJson));
  });

  r.get("/providers/:id", async (c) => {
    return c.json(providerJson(await mustGetProvider(db, c.req.param("id"))));
  });

  r.patch("/providers/:id", async (c) => {
    const id = c.req.param("id");
    await mustGetProvider(db, id);
    const body = patchSchema.parse(await parseJson(c));
    if (body.displayName) await assertNameFree(db, body.displayName, id);
    const provider = await db.provider.update({
      where: { id },
      data: {
        ...(body.displayName ? { name: body.displayName } : {}),
        ...(body.type ? { kind: TYPE_TO_KIND[body.type] } : {}),
        ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
      },
    });
    return c.json(providerJson(provider));
  });

  r.delete("/providers/:id", async (c) => {
    const id = c.req.param("id");
    await mustGetProvider(db, id);
    const accounts = await db.account.count({ where: { providerId: id } });
    if (accounts > 0) {
      throw new ApiError(409, "provider_has_accounts", "provider still has accounts");
    }
    await db.provider.delete({ where: { id } });
    return c.body(null, 204);
  });

  return r;
}
