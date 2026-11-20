import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { decryptSecret } from "../lib/crypto.ts";
import { balancer } from "./balancer.ts";
import type { ResolvedMapping, ResolvedRequest } from "./resolve.ts";

/**
 * Shared proxy skeleton for both wire edges: balancer pick → upstream POST →
 * passthrough streaming response, with pre-first-byte failover. Response bytes
 * pipe to the client unparsed and unmodified (except the one documented
 * transform the caller may request: suppression of the forced usage chunk).
 * The assembler taps a COPY of the bytes (assembler.feed) and never delays
 * the client stream.
 */

/** Hop-by-hop headers never forwarded, plus fields the proxy recomputes itself. */
const SKIP_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
  "authorization",
  "content-type",
]);

/** CommandCode's Cloudflare edge 403s default library UAs; absent client UA gets ours. */
export const PASSE_TROU_UA = "passe-trou/0.1 (-https://github.com/WyliGr/passe-trou)";

export interface StreamAssembler {
  feed(chunk: Uint8Array): void;
}

export interface ForwardOpts {
  resolved: ResolvedRequest;
  /** Path under the account base URL, e.g. "chat/completions" or "messages". */
  upstreamPath: string;
  buildUpstreamBody: (mapping: ResolvedMapping) => Record<string, unknown>;
  /** Assembler lives across (rare) failover; only the successful attempt's bytes are fed. */
  assembler: StreamAssembler;
  /** Strip upstream terminal usage chunks from the client stream (forced include_usage). */
  suppressUsageChunks?: boolean;
}

interface UpstreamError {
  status: number;
  contentType: string | null;
  retryAfter: string | null;
  body: Uint8Array<ArrayBuffer>;
}

export async function forwardToPool(
  c: Context,
  deps: { db: Db; masterKey: Buffer },
  opts: ForwardOpts,
): Promise<Response> {
  const tried = new Set<string>();
  let lastError: UpstreamError | null = null;

  for (;;) {
    const candidates = opts.resolved.mappings
      .filter((m) => !tried.has(m.id))
      .map((m) => ({ id: m.id, accountId: m.accountId }));
    const mappingId = balancer.pick(candidates);

    if (mappingId === null) {
      // No alternates left. All-cooling from the start → pool_exhausted;
      // mid-loop exhaustion → forward the last upstream error verbatim.
      if (lastError) return forwardUpstreamError(c, lastError);
      const remaining = opts.resolved.mappings
        .map((m) => balancer.cooldownRemainingSec(m.id))
        .filter((s): s is number => s !== null);
      const retryAfterSec = remaining.length > 0 ? Math.min(...remaining) : 0;
      return c.json(
        {
          error: {
            code: "pool_exhausted",
            message: "all accounts for this model are cooling down",
            retryAfterSec,
          },
        },
        503,
        retryAfterSec > 0 ? { "retry-after": String(retryAfterSec) } : {},
      );
    }

    const mapping = opts.resolved.mappings.find((m) => m.id === mappingId)!;
    tried.add(mappingId);
    balancer.recordStart(mappingId);

    const attempt = await tryUpstream(c, deps, opts, mapping);
    if (attempt.ok) {
      balancer.recordDone(mappingId);
      return attempt.response;
    }
    lastError = attempt.error;

    if (attempt.status === 429 || attempt.status >= 500) {
      const retryAfterSec = parseRetryAfter(attempt.error.retryAfter);
      balancer.trip(mapping.accountId, retryAfterSec !== undefined ? { retryAfterSec } : {});
      continue; // silent failover: no client byte sent yet (max once per mapping via `tried`)
    }
    // Definitive client-class error (400 etc.): forward as-is, never retry.
    balancer.recordDone(mappingId);
    return forwardUpstreamError(c, lastError);
  }
}

type Attempt =
  | { ok: true; response: Response }
  | { ok: false; status: number; error: UpstreamError };

async function tryUpstream(
  c: Context,
  deps: { db: Db; masterKey: Buffer },
  opts: ForwardOpts,
  mapping: ResolvedMapping,
): Promise<Attempt> {
  const account = mapping.account;
  const credential = await deps.db.accountCredential.findUnique({
    where: { accountId: account.id },
  });
  const baseUrl = (account.baseUrl ?? account.provider.baseUrl)?.replace(/\/+$/, "");

  if (!credential || !baseUrl) {
    // Misconfigured pool member: skip without tripping — the account is not rate-limited.
    return {
      ok: false,
      status: 502,
      error: plainError(502, "upstream_unavailable", "account has no credential or base URL"),
    };
  }

  const headers = new Headers();
  c.req.raw.headers.forEach((value, name) => {
    if (!SKIP_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  headers.set("authorization", `Bearer ${decryptSecret(credential.enc, deps.masterKey)}`);
  headers.set("content-type", "application/json");
  if (!headers.has("user-agent")) headers.set("user-agent", PASSE_TROU_UA);

  const abort = new AbortController();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/${opts.upstreamPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.buildUpstreamBody(mapping)),
      signal: abort.signal,
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: plainError(502, "upstream_unreachable", "upstream request failed"),
    };
  }

  if (!res.ok || !res.body) {
    const body = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
    return {
      ok: false,
      status: res.status,
      error: {
        status: res.status,
        contentType: res.headers.get("content-type"),
        retryAfter: res.headers.get("retry-after"),
        body,
      },
    };
  }

  const headersOut: Record<string, string> = {};
  const ct = res.headers.get("content-type");
  if (ct) headersOut["content-type"] = ct;
  const stream = opts.suppressUsageChunks
    ? filteredPipe(res.body, opts.assembler, abort)
    : teePipe(res.body, opts.assembler, abort);
  return {
    ok: true,
    response: c.body(stream, res.status as ContentfulStatusCode, headersOut),
  };
}

function plainError(status: number, code: string, message: string): UpstreamError {
  return {
    status,
    contentType: "application/json",
    retryAfter: null,
    body: new Uint8Array(new TextEncoder().encode(JSON.stringify({ error: { code, message } }))),
  };
}

function forwardUpstreamError(c: Context, err: UpstreamError): Response {
  const headers: Record<string, string> = {};
  if (err.contentType) headers["content-type"] = err.contentType;
  if (err.retryAfter) headers["retry-after"] = err.retryAfter;
  return c.body(err.body, err.status as ContentfulStatusCode, headers);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const sec = Number.parseInt(value, 10);
  return Number.isFinite(sec) && sec >= 0 ? sec : undefined;
}

/** Unparsed byte pipe upstream→client with a parallel assembler tap. */
function teePipe(
  body: ReadableStream<Uint8Array>,
  assembler: StreamAssembler,
  abort: AbortController,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        assembler.feed(value); // tap a copy; never gates the enqueue
        controller.enqueue(value);
      } catch {
        // Upstream died mid-stream: after first byte there is no retry — end the stream.
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
      void reader.cancel().catch(() => {});
    },
  });
}

/**
 * Same as teePipe, plus the one documented response transform: drop terminal
 * usage-only events the proxy itself forced (`stream_options.include_usage`)
 * when the client never asked for them. Frames are identified on byte
 * boundaries and every forwarded frame keeps its exact original bytes.
 */
function filteredPipe(
  body: ReadableStream<Uint8Array>,
  assembler: StreamAssembler,
  abort: AbortController,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  const frames: Uint8Array[] = [];
  let upstreamDone = false;

  const drain = (): void => {
    const { events, rest } = splitFrames(pending, upstreamDone);
    pending = rest;
    for (const frame of events) {
      if (!isUsageOnlyFrame(frame)) frames.push(frame);
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          drain();
          if (frames.length > 0) {
            controller.enqueue(frames.shift()!);
            return;
          }
          if (upstreamDone) {
            controller.close();
            return;
          }
          const { done, value } = await reader.read();
          if (done) {
            upstreamDone = true;
          } else {
            assembler.feed(value);
            pending = concatBytes(pending, value);
          }
        }
      } catch {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
      void reader.cancel().catch(() => {});
    },
  });
}

/** Split on SSE frame boundaries (\n\n or \r\n\r\n), keeping exact bytes. */
function splitFrames(buf: Uint8Array, flush: boolean): { events: Uint8Array[]; rest: Uint8Array } {
  const events: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    const prev = buf[i - 1];
    const prev2 = buf[i - 2];
    // boundary = empty line: \n\n or \r\n\r\n (final \n at i)
    if (prev === 0x0a || (prev === 0x0d && prev2 === 0x0a)) {
      events.push(buf.subarray(start, i + 1));
      start = i + 1;
    }
  }
  const rest = buf.subarray(start);
  if (flush && rest.length > 0) {
    events.push(rest);
    return { events, rest: new Uint8Array(0) };
  }
  return { events, rest };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Usage-only terminal chunk: empty choices + non-null usage. Parse failures forward. */
function isUsageOnlyFrame(frame: Uint8Array): boolean {
  const text = new TextDecoder().decode(frame);
  const data = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data || data === "[DONE]") return false;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return false;
    const chunk = parsed as { choices?: unknown; usage?: unknown };
    return Array.isArray(chunk.choices) && chunk.choices.length === 0 && chunk.usage != null;
  } catch {
    return false;
  }
}

export function assertJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_request", "request body must be a JSON object");
  }
  return raw as Record<string, unknown>;
}
