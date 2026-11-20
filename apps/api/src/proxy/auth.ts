import type { MiddlewareHandler } from "hono";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { ApiKey, ApiKeyModel, Member } from "../generated/prisma/client.ts";
import { hashKey } from "../lib/crypto.ts";

/** Key row as the proxy needs it: member (for enabled check) + allowlist. */
export type AuthedKey = ApiKey & { member: Member; allowedModels: ApiKeyModel[] };

/**
 * Bearer gate for /v1/* proxy routes. passe•trou keys are `pt_…`,
 * persisted only as sha256 hex — lookup by hash, never by plaintext.
 * Unknown, disabled, or disabled-member keys all get the same 401.
 * Sets c.get("key") for downstream handlers.
 */
export function proxyAuth(db: Db): MiddlewareHandler<{ Variables: { key: AuthedKey } }> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const key = token.startsWith("pt_")
      ? await db.apiKey.findUnique({
          where: { sha256: hashKey(token) },
          include: { member: true, allowedModels: true },
        })
      : null;
    if (!key || !key.enabled || !key.member.enabled) {
      throw new ApiError(401, "invalid_api_key", "missing, unknown, or disabled API key");
    }
    c.set("key", key);
    await next();
  };
}
