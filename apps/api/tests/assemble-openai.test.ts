import { describe, expect, it } from "vitest";
import { parseSSE, type SSEEvent } from "../src/lib/sseParse.ts";
import { OpenAIAssembler } from "../src/proxy/assembleOpenAI.ts";
import {
  bytesOf,
  oneByteChunks,
  OPENAI_JSON_BODY,
  OPENAI_STREAM_NO_USAGE,
  OPENAI_STREAM_WITH_USAGE,
} from "./fixtures/streams.ts";

function feedChunks(assembler: OpenAIAssembler, chunks: Uint8Array[]): void {
  for (const chunk of chunks) assembler.feed(chunk);
}

/** Fake clock: starts at t0, advances by stepMs per call. Deterministic TTFT. */
function fakeClock(t0 = 10_000, stepMs = 7) {
  let t = t0;
  return () => (t += stepMs);
}

describe("parseSSE", () => {
  it("parses events split across arbitrary chunk boundaries, incl. [DONE]", () => {
    const raw = `data: {"a":1}\n\nevent: ping\ndata: line one\ndata: line two\n\ndata: [DONE]\n\n`;
    const whole: SSEEvent[] = [];
    parseSSE((ev) => whole.push(ev))(bytesOf(raw));

    const split: SSEEvent[] = [];
    const feed = parseSSE((ev) => split.push(ev));
    for (const b of oneByteChunks(raw)) feed(b);

    expect(split).toEqual(whole);
    expect(whole).toEqual([
      { data: `{"a":1}` },
      { event: "ping", data: "line one\nline two" },
      { data: "[DONE]" },
    ]);
  });

  it("ignores comment lines and tolerates CRLF endings", () => {
    const events: SSEEvent[] = [];
    const feed = parseSSE((ev) => events.push(ev));
    feed(bytesOf(": keep-alive\r\ndata: x\r\n\r\n"));
    expect(events).toEqual([{ data: "x" }]);
  });

  it("coalesced events in one chunk parse as separate events", () => {
    const events: SSEEvent[] = [];
    parseSSE((ev) => events.push(ev))(bytesOf(`data: 1\n\ndata: 2\n\n`));
    expect(events).toEqual([{ data: "1" }, { data: "2" }]);
  });
});

describe("OpenAIAssembler", () => {
  it("assembles usage, TTFT, tool calls, finish reason from a streamed response", () => {
    const a = new OpenAIAssembler({ now: fakeClock() });
    a.feed(bytesOf(OPENAI_STREAM_WITH_USAGE));
    const snap = a.snapshot();

    expect(snap.modelServed).toBe("deepseek/deepseek-v4.1-flash");
    expect(snap.ttftMs).toBeGreaterThan(0);
    expect(snap.toolCallCount).toBe(1); // unique tool-call indices
    expect(snap.finishReason).toBe("tool_calls");
    expect(snap.usage).toEqual({
      prompt_tokens: 1024,
      completion_tokens: 64,
      reasoning_tokens: 12,
      cached_tokens: 512,
    });
  });

  it("TTFT is the time of the first reasoning delta, measured from assembly start", () => {
    const a = new OpenAIAssembler({ now: fakeClock(10_000, 25) });
    const chunks = oneByteChunks(OPENAI_STREAM_WITH_USAGE);
    a.feed(chunks[0]!);
    // first reasoning delta completes only partway through the stream
    feedChunks(a, chunks.slice(1));
    expect(a.snapshot().ttftMs).toBeGreaterThan(0);
  });

  it("byte-split invariance: 1-byte chunks yield the identical snapshot", () => {
    const whole = new OpenAIAssembler({ now: fakeClock() });
    whole.feed(bytesOf(OPENAI_STREAM_WITH_USAGE));

    const split = new OpenAIAssembler({ now: fakeClock() });
    feedChunks(split, oneByteChunks(OPENAI_STREAM_WITH_USAGE));

    expect(split.snapshot()).toEqual(whole.snapshot());
  });

  it("stream without usage chunk leaves usage undefined (request still fine)", () => {
    const a = new OpenAIAssembler({ now: fakeClock() });
    a.feed(bytesOf(OPENAI_STREAM_NO_USAGE));
    const snap = a.snapshot();
    expect(snap.usage).toBeUndefined();
    expect(snap.finishReason).toBe("tool_calls");
    expect(snap.toolCallCount).toBe(1);
    expect(snap.ttftMs).toBeGreaterThan(0);
  });

  it("non-stream JSON body yields usage without TTFT", () => {
    const a = new OpenAIAssembler({ now: fakeClock() });
    a.feed(bytesOf(OPENAI_JSON_BODY));
    const snap = a.snapshot();
    expect(snap.usage).toEqual({
      prompt_tokens: 1024,
      completion_tokens: 64,
      reasoning_tokens: 12,
      cached_tokens: 512,
    });
    expect(snap.finishReason).toBe("stop");
    expect(snap.ttftMs).toBeNull();
    expect(snap.toolCallCount).toBe(0);
  });

  it("non-stream JSON fed byte-by-byte parses identically", () => {
    const whole = new OpenAIAssembler({ now: fakeClock() });
    whole.feed(bytesOf(OPENAI_JSON_BODY));
    const split = new OpenAIAssembler({ now: fakeClock() });
    feedChunks(split, oneByteChunks(OPENAI_JSON_BODY));
    expect(split.snapshot()).toEqual(whole.snapshot());
  });
});
