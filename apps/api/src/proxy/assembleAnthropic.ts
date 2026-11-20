import { parseSSE } from "../lib/sseParse.ts";
import type { UsageSnapshot } from "./assembleOpenAI.ts";

/**
 * Metrics-only snapshot of an Anthropic-wire response, assembled from a tee'd
 * COPY of the byte stream. Usage merges `message_start.usage` (input side)
 * with the terminal `message_delta.usage` (output side incl. thinking).
 */

export interface AnthropicSnapshot {
  /** ms from assembly start to first content/thinking delta; null for non-stream. */
  ttftMs: number | null;
  usage?: UsageSnapshot;
  /** Count of tool_use content blocks. */
  toolCallCount: number;
  stopReason?: string;
  modelServed?: string;
}

interface WireUsageIn {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}

interface WireEvent {
  type?: string;
  message?: { model?: string; usage?: WireUsageIn };
  content_block?: { type?: string };
  delta?: { type?: string; stop_reason?: string | null };
  usage?: WireUsageIn;
}

export class AnthropicAssembler {
  private readonly now: () => number;
  private readonly startedAt: number;
  private sseFeed: ((chunk: Uint8Array) => void) | null = null;

  private mode: "unknown" | "sse" | "json" = "unknown";
  private jsonBuf: number[] = [];
  private jsonDone = false;

  private ttftMs: number | null = null;
  private promptTokens: number | undefined;
  private completionTokens: number | undefined;
  private reasoningTokens: number | undefined;
  private cachedTokens: number | undefined;
  private toolCallCount = 0;
  private stopReason: string | undefined;
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

  snapshot(): AnthropicSnapshot {
    const snap: AnthropicSnapshot = { ttftMs: this.ttftMs, toolCallCount: this.toolCallCount };
    const usage = this.buildUsage();
    if (usage) snap.usage = usage;
    if (this.stopReason !== undefined) snap.stopReason = this.stopReason;
    if (this.modelServed !== undefined) snap.modelServed = this.modelServed;
    return snap;
  }

  private buildUsage(): UsageSnapshot | undefined {
    if (this.promptTokens === undefined || this.completionTokens === undefined) return undefined;
    const usage: UsageSnapshot = {
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
    };
    if (this.reasoningTokens !== undefined) usage.reasoning_tokens = this.reasoningTokens;
    if (this.cachedTokens !== undefined) usage.cached_tokens = this.cachedTokens;
    return usage;
  }

  private mergeUsage(u: WireUsageIn | undefined, side: "start" | "delta"): void {
    if (!u) return;
    if (side === "start") {
      if (typeof u.input_tokens === "number") this.promptTokens = u.input_tokens;
      if (typeof u.output_tokens === "number") this.completionTokens = u.output_tokens;
    } else {
      // CommandCode's terminal message_delta carries cumulative output_tokens.
      if (typeof u.output_tokens === "number") this.completionTokens = u.output_tokens;
      if (typeof u.input_tokens === "number" && this.promptTokens === undefined) {
        this.promptTokens = u.input_tokens;
      }
    }
    const thinking = u.output_tokens_details?.thinking_tokens;
    if (typeof thinking === "number") this.reasoningTokens = thinking;
    if (typeof u.cache_read_input_tokens === "number") this.cachedTokens = u.cache_read_input_tokens;
  }

  private onEvent(data: string): void {
    let ev: WireEvent;
    try {
      ev = JSON.parse(data);
    } catch {
      return; // tap ignores unparseable frames; the client already got the bytes
    }
    switch (ev.type) {
      case "message_start":
        if (ev.message?.model && this.modelServed === undefined) {
          this.modelServed = ev.message.model;
        }
        this.mergeUsage(ev.message?.usage, "start");
        break;
      case "content_block_start":
        if (ev.content_block?.type === "tool_use") this.toolCallCount += 1;
        break;
      case "content_block_delta":
        if (
          this.ttftMs === null &&
          (ev.delta?.type === "text_delta" || ev.delta?.type === "thinking_delta")
        ) {
          this.ttftMs = this.now() - this.startedAt;
        }
        break;
      case "message_delta":
        this.mergeUsage(ev.usage, "delta");
        if (ev.delta?.stop_reason) this.stopReason = ev.delta.stop_reason;
        break;
      default:
        break; // ping, content_block_stop, message_stop: no metrics content
    }
  }

  private tryParseJson(): void {
    let body: {
      model?: string;
      stop_reason?: string | null;
      content?: Array<{ type?: string }>;
      usage?: WireUsageIn;
    };
    try {
      body = JSON.parse(Buffer.from(this.jsonBuf).toString("utf8"));
    } catch {
      return; // incomplete JSON — keep buffering
    }
    this.jsonDone = true;
    if (body.model) this.modelServed = body.model;
    this.mergeUsage(body.usage, "start");
    if (body.stop_reason) this.stopReason = body.stop_reason;
    for (const block of body.content ?? []) {
      if (block.type === "tool_use") this.toolCallCount += 1;
    }
  }
}
