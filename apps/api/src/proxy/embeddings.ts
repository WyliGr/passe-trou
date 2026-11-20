import { Hono } from "hono";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { OpenAIAssembler } from "./assembleOpenAI.ts";
import type { AuthedKey } from "./auth.ts";
import { assertJsonObject, forwardToPool } from "./forward.ts";
import { resolveRequest } from "./resolve.ts";

/**
 * POST /v1/embeddings — non-stream passthrough on openai-kind mappings only.
 * Usage rows carry prompt tokens (embeddings have no completion count); cost
 * is input-priced only, handled by the capture layer.
 */
export function embeddingsRouter(deps: { db: Db; masterKey: Buffer }) {
  const r = new Hono<{ Variables: { key: AuthedKey } }>();

  r.post("/embeddings", async (c) => {
    const clientBody = assertJsonObject(
      await c.req.json().catch(() => {
        throw new ApiError(400, "invalid_request", "request body must be valid JSON");
      }),
    );
    const requestedModel = clientBody.model;
    if (typeof requestedModel !== "string" || requestedModel.length === 0) {
      throw new ApiError(400, "invalid_request", "model is required");
    }

    const key = c.get("key");
    const resolved = await resolveRequest(deps.db, requestedModel, "openai", key);

    return forwardToPool(c, deps, {
      resolved,
      upstreamPath: "embeddings",
      assembler: new OpenAIAssembler(),
      capture: {
        key,
        model: resolved.model,
        wireFormat: "openai",
        stream: false,
        startedAt: Date.now(),
        clientName: c.req.header("x-client-name") ?? null,
      },
      buildUpstreamBody: (mapping) => ({
        ...clientBody,
        model: mapping.upstreamModel ?? requestedModel,
      }),
    });
  });

  return r;
}
