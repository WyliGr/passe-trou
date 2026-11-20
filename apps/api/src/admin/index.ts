import { Hono } from "hono";
import type { AppDeps } from "../app.ts";
import { accountsRouter } from "./accounts.ts";
import { analyticsRouter } from "./analytics.ts";
import { analyticsSummaryRouter } from "./analytics-summary.ts";
import { analyticsTimeseriesRouter } from "./analytics-timeseries.ts";
import { credentialsRouter } from "./credentials.ts";
import { keysRouter } from "./keys.ts";
import { membersRouter } from "./members.ts";
import { modelsRouter } from "./models.ts";
import { overviewRouter } from "./overview.ts";
import { pricesRouter } from "./prices.ts";
import { requestsRouter } from "./requests.ts";
import { providersRouter } from "./providers.ts";
import { testConnectionRouter } from "./test-connection.ts";

/** All /admin routes; mounted under adminAuth in app.ts. */
export function adminRouter(deps: AppDeps) {
  const r = new Hono();
  r.route("/", providersRouter(deps.db));
  r.route("/", accountsRouter(deps.db));
  r.route("/", credentialsRouter(deps.db, deps.masterKey));
  r.route("/", modelsRouter(deps.db));
  r.route("/", membersRouter(deps.db));
  r.route("/", keysRouter(deps.db));
  r.route("/", pricesRouter(deps.db));
  r.route("/", overviewRouter(deps.db));
  r.route("/", analyticsRouter({ heartbeatMs: deps.feedHeartbeatMs }));
  r.route("/", analyticsSummaryRouter(deps.db));
  r.route("/", analyticsTimeseriesRouter(deps.db));
  r.route("/", requestsRouter(deps.db));
  r.route("/", testConnectionRouter(deps.db, deps.masterKey));
  return r;
}
