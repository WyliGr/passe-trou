import { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { providersRouter } from "./providers.ts";

/** All /admin routes; mounted under adminAuth in app.ts. */
export function adminRouter(deps: AppDeps) {
  const r = new Hono();
  r.route("/", providersRouter(deps.db));
  return r;
}
