import { Hono } from "hono";
import type { Db } from "../db.ts";
import type { AuthedKey } from "./auth.ts";

/**
 * GET /v1/models — OpenAI list shape. Only models the key may actually use:
 * enabled, intersected with the key allowlist (empty allowlist = wildcard).
 */
export function modelsListRouter(deps: { db: Db }) {
  const r = new Hono<{ Variables: { key: AuthedKey } }>();

  r.get("/models", async (c) => {
    const key = c.get("key");
    const allowlist = new Set(key.allowedModels.map((m) => m.modelId));
    const enabled = await deps.db.model.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" },
    });
    const visible = enabled.filter((m) => allowlist.size === 0 || allowlist.has(m.id));
    return c.json({
      object: "list",
      data: visible.map((m) => ({
        id: m.name,
        object: "model",
        created: Math.floor(m.createdAt.getTime() / 1000),
        owned_by: "passe•trou",
      })),
    });
  });

  return r;
}
