import { Hono } from "hono";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { OpenAIAssembler } from "./assembleOpenAI.ts";
import type { AuthedKey } from "./auth.ts";
import { assertJsonObject, forwardToPool } from "./forward.ts";
import { resolveRequest } from "./resolve.ts";

/**
 * OpenAI edge. Byte-pure passthrough with two documented request transforms:
 * model → upstreamModel rewrite, and (stream only) forced
 * stream_options.include_usage so per-request usage accounting always lands.
 */
export function openaiRouter(deps: { db: Db; masterKey: Buffer }) {
  const r = new Hono<{ Variables: { key: AuthedKey } }>();

  r.post("/chat/completions", async (c) => {
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
    const isStream = clientBody.stream === true;
    const clientSetStreamOptions = clientBody.stream_options != null;

    return forwardToPool(c, deps, {
      resolved,
      upstreamPath: "chat/completions",
      assembler: new OpenAIAssembler(),
      suppressUsageChunks: isStream && !clientSetStreamOptions,
      capture: {
        key,
        model: resolved.model,
        wireFormat: "openai",
        stream: isStream,
        startedAt: Date.now(),
        clientName: c.req.header("x-client-name") ?? null,
      },
      buildUpstreamBody: (mapping) => {
        const body: Record<string, unknown> = {
          ...clientBody,
          model: mapping.upstreamModel ?? requestedModel,
        };
        if (isStream) {
          const existing =
            typeof clientBody.stream_options === "object" && clientBody.stream_options !== null
              ? (clientBody.stream_options as Record<string, unknown>)
              : {};
          body.stream_options = { ...existing, include_usage: true };
        }
        return body;
      },
    });
  });

  return r;
}
