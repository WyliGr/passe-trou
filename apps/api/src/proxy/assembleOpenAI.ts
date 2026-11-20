import { parseSSE } from "../lib/sseParse.ts";

/**
 * Metrics-only snapshot of an OpenAI-wire response, assembled from a tee'd
 * COPY of the byte stream. The stream to the client never waits on this.
 */

/** Normalized per-request usage; field names mirror the OpenAI wire shape.
 * Fields null when the wire omits them (embeddings carry no completion count). */
export interface UsageSnapshot {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

export interface OpenAISnapshot {
  /** ms from assembly start to first content/reasoning delta; null for non-stream. */
  ttftMs: number | null;
  usage?: UsageSnapshot;
  /** Unique tool-call indices seen across deltas (stream) or message.tool_calls (non-stream). */
  toolCallCount: number;
  finishReason?: string;
  /** `model` as reported by the upstream (may differ from requested/mapped). */
  modelServed?: string;
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
}

interface WireChoice {
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{ index?: number }>;
  };
  message?: { tool_calls?: unknown[] };
  finish_reason?: string | null;
}

export class OpenAIAssembler {
  private readonly now: () => number;
  private readonly startedAt: number;
  private sseFeed: ((chunk: Uint8Array) => void) | null = null;

  private mode: "unknown" | "sse" | "json" = "unknown";
  private jsonBuf: number[] = [];
  private jsonDone = false;

  private ttftMs: number | null = null;
  private usage: UsageSnapshot | undefined;
  private readonly toolIndices = new Set<number>();
  private toolCountNonStream = 0;
  private finishReason: string | undefined;
  private modelServed: string | undefined;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
    this.sseFeed = parseSSE((ev) => this.onEvent(ev.data));
  }

  feed(chunk: Uint8Array): void {
    if (this.jsonDone) return;
    if (this.mode === "unknown") {
      let first = -1;
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i]!;
        if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
        first = b;
        break;
      }
      if (first === -1) return;
      this.mode = first === 0x7b ? "json" : "sse"; // '{'
    }
    if (this.mode === "sse") {
      this.sseFeed!(chunk);
      return;
    }
    for (const b of chunk) this.jsonBuf.push(b);
    this.tryParseJson();
  }

  snapshot(): OpenAISnapshot {
    const snap: OpenAISnapshot = {
      ttftMs: this.ttftMs,
      toolCallCount: this.mode === "json" ? this.toolCountNonStream : this.toolIndices.size,
    };
    if (this.usage) snap.usage = this.usage;
    if (this.finishReason !== undefined) snap.finishReason = this.finishReason;
    if (this.modelServed !== undefined) snap.modelServed = this.modelServed;
    return snap;
  }

  private tryParseJson(): void {
    let body: {
      model?: string;
      usage?: WireUsage;
      choices?: WireChoice[];
    };
    try {
      body = JSON.parse(Buffer.from(this.jsonBuf).toString("utf8"));
    } catch {
      return; // incomplete JSON — keep buffering
    }
    this.jsonDone = true;
    if (body.model) this.modelServed = body.model;
    if (body.usage) this.usage = extractUsage(body.usage);
    const choice = body.choices?.[0];
    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    if (choice?.message?.tool_calls) this.toolCountNonStream = choice.message.tool_calls.length;
  }

  private onEvent(data: string): void {
    if (data === "[DONE]") return;
    let chunkData: { model?: string; usage?: WireUsage; choices?: WireChoice[] };
    try {
      chunkData = JSON.parse(data);
    } catch {
      return; // unparseable event: tap ignores, bytes already went to the client
    }
    if (chunkData.model && this.modelServed === undefined) this.modelServed = chunkData.model;
    if (chunkData.usage) this.usage = extractUsage(chunkData.usage);
    for (const choice of chunkData.choices ?? []) {
      const delta = choice.delta;
      if (this.ttftMs === null && delta && (delta.content || delta.reasoning_content)) {
        this.ttftMs = this.now() - this.startedAt;
      }
      for (const tc of delta?.tool_calls ?? []) {
        if (typeof tc.index === "number") this.toolIndices.add(tc.index);
      }
      if (choice.finish_reason) this.finishReason = choice.finish_reason;
    }
  }
}

function extractUsage(u: WireUsage): UsageSnapshot | undefined {
  if (typeof u.prompt_tokens !== "number" && typeof u.completion_tokens !== "number") {
    return undefined;
  }
  const out: UsageSnapshot = {
    prompt_tokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
    completion_tokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null,
  };
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === "number") out.reasoning_tokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number") out.cached_tokens = cached;
  return out;
}
