import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { ApiError } from "../app.ts";

/** Bearer-token gate for every /admin/* route. Token comes from env (ADMIN_TOKEN). */
export function adminAuth(adminToken: string): MiddlewareHandler {
  const expected = Buffer.from(adminToken);
  return async (c, next) => {
    const header = c.req.header("authorization");
    const presented = header?.startsWith("Bearer ") ? Buffer.from(header.slice(7)) : null;
    const ok =
      presented !== null &&
      presented.length === expected.length &&
      timingSafeEqual(presented, expected);
    if (!ok) {
      throw new ApiError(401, "unauthorized", "missing or invalid admin token");
    }
    await next();
  };
}
