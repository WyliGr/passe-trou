import { Hono } from "hono";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { AnthropicAssembler } from "./assembleAnthropic.ts";
import type { AuthedKey } from "./auth.ts";
import { assertJsonObject, forwardToPool } from "./forward.ts";
import { resolveRequest } from "./resolve.ts";

/**
 * Anthropic edge for claude-* backends. Same guard/balancer/failover skeleton
 * as the OpenAI edge. Passthrough with the single documented request
 * transform: model → upstreamModel rewrite. anthropic-version / anthropic-beta
 * reach the upstream via generic header forwarding. Anthropic streams always
 * carry usage, so no usage-chunk filtering exists on this edge.
 */
export function anthropicRouter(deps: { db: Db; masterKey: Buffer }) {
  const r = new Hono<{ Variables: { key: AuthedKey } }>();

  r.post("/messages", async (c) => {
    const clientBody = assertJsonObject(
      await c.req.json().catch(() => {
        throw new ApiError(400, "invalid_request", "request body must be valid JSON");
      }),
    );
    const requestedModel = clientBody.model;
    if (typeof requestedModel !== "string" || requestedModel.length === 0) {
      throw new ApiError(400, "invalid_request", "model is required");
    }

    const resolved = await resolveRequest(deps.db, requestedModel, "anthropic", c.get("key"));

    return forwardToPool(c, deps, {
      resolved,
      upstreamPath: "messages",
      assembler: new AnthropicAssembler(),
      buildUpstreamBody: (mapping) => ({
        ...clientBody,
        model: mapping.upstreamModel ?? requestedModel,
      }),
    });
  });

  return r;
}
