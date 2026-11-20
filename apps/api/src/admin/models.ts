import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { Model, ModelAccount, Provider, Account } from "../generated/prisma/client.ts";

const createSchema = z.object({
  displayName: z.string().trim().min(1),
  enabled: z.boolean().default(true),
});

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .partial();

const mappingCreateSchema = z.object({
  accountId: z.string().min(1),
  upstreamModel: z.string().trim().min(1).optional(),
});

type MappingWithAccount = ModelAccount & { account: Account & { provider: Provider } };
type ModelWithMappings = Model & { mappings: MappingWithAccount[] };

function mappingJson(m: MappingWithAccount) {
  return {
    id: m.id,
    accountId: m.accountId,
    accountName: m.account.label,
    providerName: m.account.provider.name,
    providerType: m.account.provider.kind === "openai" ? "openai-compatible" : "anthropic-compatible",
    accountEnabled: m.account.enabled,
    upstreamModel: m.upstreamModel,
  };
}

function modelJson(m: ModelWithMappings) {
  return {
    id: m.id,
    displayName: m.name,
    enabled: m.enabled,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    mappings: m.mappings.map(mappingJson),
  };
}

const WITH_MAPPINGS = {
  mappings: {
    orderBy: { createdAt: "asc" as const },
    include: { account: { include: { provider: true } } },
  },
};

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "request body must be valid JSON");
  }
}

async function mustGetModel(db: Db, id: string) {
  const model = await db.model.findUnique({ where: { id }, include: WITH_MAPPINGS });
  if (!model) throw new ApiError(404, "not_found", "model not found");
  return model;
}

async function assertNameFree(db: Db, displayName: string, excludeId?: string) {
  const clash = await db.model.findFirst({
    where: { name: displayName, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ApiError(409, "duplicate_name", "displayName already in use");
}

export function modelsRouter(db: Db) {
  const r = new Hono();

  r.post("/models", async (c) => {
    const body = createSchema.parse(await parseJson(c));
    await assertNameFree(db, body.displayName);
    const model = await db.model.create({
      data: { name: body.displayName, enabled: body.enabled },
      include: WITH_MAPPINGS,
    });
    return c.json(modelJson(model), 201);
  });

  r.get("/models", async (c) => {
    const models = await db.model.findMany({
      orderBy: { createdAt: "asc" },
      include: WITH_MAPPINGS,
    });
    return c.json(models.map(modelJson));
  });

  r.get("/models/:id", async (c) => {
    return c.json(modelJson(await mustGetModel(db, c.req.param("id"))));
  });

  r.patch("/models/:id", async (c) => {
    const id = c.req.param("id");
    await mustGetModel(db, id);
    const body = patchSchema.parse(await parseJson(c));
    if (body.displayName) await assertNameFree(db, body.displayName, id);
    const model = await db.model.update({
      where: { id },
      data: {
        ...(body.displayName ? { name: body.displayName } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
      include: WITH_MAPPINGS,
    });
    return c.json(modelJson(model));
  });

  r.delete("/models/:id", async (c) => {
    const model = await mustGetModel(db, c.req.param("id"));
    if (model.mappings.length > 0) {
      throw new ApiError(409, "model_has_mappings", "model still has mappings");
    }
    // ApiKeyModel cascades on model delete; an emptied allowlist becomes the
    // wildcard (all models), which would silently widen that key's access.
    const allowlisted = await db.apiKeyModel.count({ where: { modelId: model.id } });
    if (allowlisted > 0) {
      throw new ApiError(409, "model_in_allowlist", "model is in at least one key allowlist");
    }
    await db.model.delete({ where: { id: model.id } });
    return c.body(null, 204);
  });

  // Mapping authoring: binds one account to the logical model.
  r.post("/models/:id/mappings", async (c) => {
    const model = await mustGetModel(db, c.req.param("id"));
    const body = mappingCreateSchema.parse(await parseJson(c));
    const account = await db.account.findUnique({
      where: { id: body.accountId },
      include: { provider: true },
    });
    if (!account) throw new ApiError(404, "not_found", "account not found");
    const existing = await db.modelAccount.findUnique({
      where: { modelId_accountId: { modelId: model.id, accountId: body.accountId } },
    });
    if (existing) {
      throw new ApiError(409, "duplicate_mapping", "account already mapped to this model");
    }
    const mapping = await db.modelAccount.create({
      data: {
        modelId: model.id,
        accountId: body.accountId,
        ...(body.upstreamModel ? { upstreamModel: body.upstreamModel } : {}),
      },
      include: { account: { include: { provider: true } } },
    });
    return c.json(mappingJson(mapping), 201);
  });

  r.delete("/mappings/:mappingId", async (c) => {
    const id = c.req.param("mappingId");
    const mapping = await db.modelAccount.findUnique({ where: { id } });
    if (!mapping) throw new ApiError(404, "not_found", "mapping not found");
    await db.modelAccount.delete({ where: { id } });
    return c.body(null, 204);
  });

  return r;
}
