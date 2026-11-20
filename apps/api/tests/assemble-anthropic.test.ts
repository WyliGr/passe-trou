import { describe, expect, it } from "vitest";
import { AnthropicAssembler } from "../src/proxy/assembleAnthropic.ts";
import {
  ANTHROPIC_JSON_BODY,
  ANTHROPIC_STREAM,
  bytesOf,
  oneByteChunks,
} from "./fixtures/streams.ts";

function fakeClock(t0 = 10_000, stepMs = 7) {
  let t = t0;
  return () => (t += stepMs);
}

describe("AnthropicAssembler", () => {
  it("assembles usage, TTFT, tool_use count and stop reason from a stream", () => {
    const a = new AnthropicAssembler({ now: fakeClock() });
    a.feed(bytesOf(ANTHROPIC_STREAM));
    const snap = a.snapshot();

    expect(snap.ttftMs).toBeGreaterThan(0); // first thinking delta
    expect(snap.usage).toEqual({ prompt_tokens: 100, completion_tokens: 42, reasoning_tokens: 12 });
    expect(snap.toolCallCount).toBe(1);
    expect(snap.stopReason).toBe("tool_use");
    expect(snap.modelServed).toBe("claude-sonnet-4");
  });

  it("byte-split invariance: 1-byte chunks yield the identical snapshot", () => {
    const whole = new AnthropicAssembler({ now: fakeClock() });
    whole.feed(bytesOf(ANTHROPIC_STREAM));

    const split = new AnthropicAssembler({ now: fakeClock() });
    for (const chunk of oneByteChunks(ANTHROPIC_STREAM)) split.feed(chunk);

    expect(split.snapshot()).toEqual(whole.snapshot());
  });

  it("non-stream JSON body yields usage without TTFT", () => {
    const a = new AnthropicAssembler({ now: fakeClock() });
    a.feed(bytesOf(ANTHROPIC_JSON_BODY));
    const snap = a.snapshot();
    expect(snap.usage).toEqual({ prompt_tokens: 100, completion_tokens: 9, reasoning_tokens: 3 });
    expect(snap.stopReason).toBe("end_turn");
    expect(snap.ttftMs).toBeNull();
  });

  it("missing thinking details leave reasoning_tokens absent", () => {
    const stream = ANTHROPIC_STREAM.replace(',"output_tokens_details":{"thinking_tokens":12}', "");
    const a = new AnthropicAssembler({ now: fakeClock() });
    a.feed(bytesOf(stream));
    expect(a.snapshot().usage).toEqual({ prompt_tokens: 100, completion_tokens: 42 });
  });
});
