import type { Context } from "hono";
import pino from "pino";
import type { Db } from "../db.ts";
import type { Model, ProviderKind } from "../generated/prisma/client.ts";
import { computeCost, findPrice, type PriceLike } from "../lib/cost.ts";
import type { AuthedKey } from "./auth.ts";
import type { ResolvedMapping } from "./resolve.ts";

/**
 * Request-row persistence for the proxy plane. Fire-and-forget by contract:
 * recordRequest returns void and never blocks the client path — failures only
 * log. Requested model rows always land, including errors before any mapping
 * (401 invalid key, wrong wire 400…) with null account/model ids, and client
 * aborts mid-stream (outcome "aborted", upstream already aborted by the pipe).
 */

const log = pino({ name: "capture" });

/** Usage as the capture layer needs it; embeddings rows carry a null completion. */
export interface CaptureUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

/** Fields the edge knows before the forward attempt (serving mapping comes later). */
export interface CaptureBase {
  key: AuthedKey;
  model: Model;
  wireFormat: ProviderKind;
  stream: boolean;
  startedAt: number;
  clientName?: string | null;
}

export interface CaptureCtx {
  key: AuthedKey | null;
  model: Model | null;
  mapping?: ResolvedMapping | null | undefined;
  wireFormat: ProviderKind;
  stream: boolean;
  startedAt: number;
  ttftMs?: number | null | undefined;
  usage?: CaptureUsage | undefined;
  toolCallCount?: number | null | undefined;
  finishReason?: string | null | undefined;
  httpStatus: number;
  outcome: "ok" | "error" | "aborted";
  errorCode?: string | null | undefined;
  clientName?: string | null | undefined;
  /** Best-effort model string for rows whose resolution never happened. */
  requestedModel?: string;
}

/** Fire-and-forget. Never awaited on the chunk path (rejected-work violation). */
export function recordRequest(db: Db, ctx: CaptureCtx): void {
  void persist(db, ctx).catch((err) => log.error({ err }, "request capture failed"));
}

async function persist(db: Db, ctx: CaptureCtx): Promise<void> {
  const latencyMs = Math.max(0, Date.now() - ctx.startedAt);
  const upstreamModel = ctx.mapping
    ? (ctx.mapping.upstreamModel ?? ctx.model?.name ?? null)
    : null;
  const costUsd = await costFor(db, ctx, upstreamModel);
  await db.request.create({
    data: {
      keyId: ctx.key?.id ?? null,
      memberId: ctx.key?.memberId ?? null,
      accountId: ctx.mapping?.accountId ?? null,
      modelId: ctx.model?.id ?? null,
      requestedModel: ctx.requestedModel ?? ctx.model?.name ?? "",
      upstreamModel,
      wireFormat: ctx.wireFormat,
      stream: ctx.stream,
      status: ctx.outcome,
      httpStatus: ctx.httpStatus,
      errorCode: ctx.errorCode ?? null,
      latencyMs,
      ttftMs: ctx.ttftMs ?? null,
      promptTokens: ctx.usage?.prompt_tokens ?? null,
      completionTokens: ctx.usage?.completion_tokens ?? null,
      reasoningTokens: ctx.usage?.reasoning_tokens ?? null,
      cachedTokens: ctx.usage?.cached_tokens ?? null,
      toolCallCount: ctx.toolCallCount ?? null,
      finishReason: ctx.finishReason ?? null,
      costUsd,
      clientName: ctx.clientName ?? null,
    },
  });
}

async function costFor(
  db: Db,
  ctx: CaptureCtx,
  upstreamModel: string | null,
): Promise<number | null> {
  const { mapping, usage } = ctx;
  if (!mapping || !usage || upstreamModel === null) return null;
  const prices = await loadPrices(db);
  const base = {
    accountId: mapping.accountId,
    providerId: mapping.account.providerId,
    upstreamModel,
  };
  if (usage.prompt_tokens !== null && usage.completion_tokens !== null) {
    return computeCost(
      {
        ...base,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        cachedTokens: usage.cached_tokens ?? null,
      },
      prices,
    );
  }
  // Prompt-only (embeddings): cost on input tokens alone, never guessed otherwise.
  if (usage.prompt_tokens !== null) {
    const price = findPrice(base, prices);
    return price ? (usage.prompt_tokens / 1_000_000) * price.priceInput : null;
  }
  return null;
}

const PRICE_TTL_MS = 30_000;
let priceCache: { at: number; rows: PriceLike[] } | null = null;

/** Test hook: seeded prices between tests must not be masked by the 30 s cache. */
export function clearPriceCache(): void {
  priceCache = null;
}

async function loadPrices(db: Db): Promise<PriceLike[]> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.rows;
  const rows = await db.price.findMany();
  priceCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Error-path capture for everything thrown under /v1/* (Hono routes thrown
 * errors to app.onError without rethrowing through middleware, so this is
 * called from the onError handler once the rendered status/code is known).
 * Only for requests that never produced a response — mapping unknown here:
 * account/model ids land as null. Fire-and-forget like recordRequest.
 */
export function recordProxyError(
  db: Db,
  c: Context,
  opts: { httpStatus: number; errorCode?: string | null },
): void {
  void (async () => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    let key: AuthedKey | null = null;
    try {
      key = c.get("key") as AuthedKey;
    } catch {
      key = null;
    }
    recordRequest(db, {
      key,
      model: null,
      mapping: null,
      wireFormat: c.req.path.includes("/messages") ? "anthropic" : "openai",
      stream: body?.stream === true,
      startedAt: Date.now(),
      httpStatus: opts.httpStatus,
      outcome: "error",
      errorCode: opts.errorCode ?? null,
      requestedModel: typeof body?.model === "string" ? body.model : "",
      clientName: c.req.header("x-client-name") ?? null,
    });
  })().catch((err) => log.error({ err }, "proxy error capture failed"));
}
