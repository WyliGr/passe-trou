import type { MiddlewareHandler } from "hono";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { getUserByToken } from "../lib/sessions.ts";

export const SESSION_COOKIE = "pt_session";

/** Reads pt_session out of a raw Cookie header (manual parse, no lib). */
export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** Session gate for every /admin/* route: Bearer token first, else pt_session cookie. */
export function adminAuth(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization");
    let token = header?.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
    token ??= readSessionCookie(c.req.header("cookie"));
    const user = token ? await getUserByToken(db, token) : null;
    if (!user) {
      throw new ApiError(401, "unauthorized", "authentication required");
    }
    c.set("user", user);
    c.set("sessionToken", token);
    await next();
  };
}
