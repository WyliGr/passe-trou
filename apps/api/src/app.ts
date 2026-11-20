import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { adminAuth } from "./admin/middleware.ts";
import { adminRouter } from "./admin/index.ts";
import type { Db } from "./db.ts";
import { proxyAuth } from "./proxy/auth.ts";
import { anthropicRouter } from "./proxy/anthropic.ts";
import { openaiRouter } from "./proxy/openai.ts";

export interface AppDeps {
  db: Db;
  adminToken: string;
  /** 32-byte AES-256 key for upstream credential vault. */
  masterKey: Buffer;
}

export interface ErrorShape {
  error: { code: string; message: string };
}

/** Consistent error body: { error: { code, message } }. */
export function errorShape(code: string, message: string): ErrorShape {
  return { error: { code, message } };
}

/** Domain error carrying an HTTP status, a machine-readable code, and optional extra error-body fields. */
export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
    public readonly code: string,
    message?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // Request logging via pino-http when running under @hono/node-server.
  // app.request() (tests) has no node req/res, so logging is skipped there.
  const httpLogger = pinoHttp({ level: process.env.LOG_LEVEL ?? "info" });
  app.use("*", async (c, next) => {
    const nodeEnv = c.env as { incoming?: IncomingMessage; outgoing?: ServerResponse } | undefined;
    if (nodeEnv?.incoming && nodeEnv?.outgoing) {
      const { incoming, outgoing } = nodeEnv;
      await new Promise<void>((resolve, reject) => {
        httpLogger(incoming, outgoing, (err?: unknown) => (err ? reject(err) : resolve()));
      });
    }
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/db/health", async (c) => {
    try {
      await deps.db.$queryRaw`SELECT 1`;
      return c.json({ ok: true });
    } catch {
      return c.json(errorShape("db_unavailable", "database health check failed"), 503);
    }
  });

  app.use("/admin/*", adminAuth(deps.adminToken));
  app.route("/admin", adminRouter(deps));

  // Proxy edge: key-based auth on everything under /v1.
  app.use("/v1/*", proxyAuth(deps.db));
  app.route("/v1", openaiRouter(deps));
  app.route("/v1", anthropicRouter(deps));

  app.notFound((c) => c.json(errorShape("not_found", `no route ${c.req.method} ${c.req.path}`), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status);
    }
    if (err instanceof HTTPException && err.status < 500) {
      return c.json(
        errorShape(STATUS_CODES[err.status] ?? "bad_request", err.message),
        err.status as ContentfulStatusCode,
      );
    }
    if (err instanceof ZodError) {
      return c.json(errorShape("invalid_request", "request validation failed"), 400);
    }
    httpLogger.logger.error({ err }, "unhandled error");
    return c.json(errorShape("internal_error", "internal server error"), 500);
  });

  return app;
}
