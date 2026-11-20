import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { Prisma } from "../generated/prisma/client.ts";

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 datetime");

const querySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  keyId: z.string().min(1).optional(),
  memberId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  status: z.enum(["ok", "error", "aborted"]).optional(),
  stream: z.enum(["true", "false"]).optional(),
  errorCode: z.string().min(1).optional(),
  minLatencyMs: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** Cursor = base64url JSON {ts, id} of the last row of the previous page. */
function encodeCursor(ts: Date, id: string): string {
  return Buffer.from(JSON.stringify({ ts: ts.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { ts: Date; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_cursor", "cursor is not valid base64url JSON");
  }
  const c = parsed as { ts?: unknown; id?: unknown };
  const ts = typeof c?.ts === "string" ? new Date(c.ts) : null;
  if (!ts || Number.isNaN(ts.getTime()) || typeof c?.id !== "string" || c.id.length === 0) {
    throw new ApiError(400, "invalid_cursor", "cursor must be base64url JSON { ts, id }");
  }
  return { ts, id: c.id };
}

/**
 * GET /admin/requests — read-only request log, newest-first
 * (ts DESC, id DESC), keyset-paginated so concurrent inserts cannot cause
 * dup/skip (no OFFSET). Relations resolved in ONE findMany via include.
 * Metrics only: no prompt/response content is ever stored or returned.
 */
export function requestsRouter(db: Db) {
  const r = new Hono();

  r.get("/requests", async (c) => {
    const q = querySchema.parse({
      from: c.req.query("from"),
      to: c.req.query("to"),
      keyId: c.req.query("keyId"),
      memberId: c.req.query("memberId"),
      accountId: c.req.query("accountId"),
      modelId: c.req.query("modelId"),
      status: c.req.query("status"),
      stream: c.req.query("stream"),
      errorCode: c.req.query("errorCode"),
      minLatencyMs: c.req.query("minLatencyMs"),
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    });

    const where: Prisma.RequestWhereInput = {
      ...(q.keyId ? { keyId: q.keyId } : {}),
      ...(q.memberId ? { memberId: q.memberId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.modelId ? { modelId: q.modelId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.stream ? { stream: q.stream === "true" } : {}),
      ...(q.errorCode ? { errorCode: q.errorCode } : {}),
      ...(q.minLatencyMs !== undefined ? { latencyMs: { gte: q.minLatencyMs } } : {}),
      ...(q.from || q.to
        ? { ts: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };

    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.AND = [
        {
          OR: [{ ts: { lt: cur.ts } }, { ts: cur.ts, id: { lt: cur.id } }],
        },
      ];
    }

    const rows = await db.request.findMany({
      where,
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      take: q.limit,
      include: {
        apiKey: { select: { id: true, label: true, prefix: true } },
        member: { select: { id: true, name: true } },
        account: { select: { id: true, label: true, provider: { select: { name: true } } } },
        model: { select: { id: true, name: true } },
      },
    });

    const last = rows.at(-1);
    return c.json({
      rows: rows.map((r) => ({
        id: r.id,
        ts: r.ts.toISOString(),
        requestedModel: r.requestedModel,
        upstreamModel: r.upstreamModel,
        wireFormat: r.wireFormat,
        stream: r.stream,
        status: r.status,
        httpStatus: r.httpStatus,
        errorCode: r.errorCode,
        latencyMs: r.latencyMs,
        ttftMs: r.ttftMs,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        reasoningTokens: r.reasoningTokens,
        cachedTokens: r.cachedTokens,
        toolCallCount: r.toolCallCount,
        finishReason: r.finishReason,
        costUsd: r.costUsd,
        clientName: r.clientName,
        key: r.apiKey,
        member: r.member,
        account: r.account
          ? { id: r.account.id, displayName: r.account.label, provider: r.account.provider.name }
          : null,
        model: r.model,
      })),
      nextCursor: rows.length === q.limit && last ? encodeCursor(last.ts, last.id) : null,
    });
  });

  return r;
}
