/**
 * Recorded CommandCode-shaped wire fixtures (metrics-only content, no real
 * user data). Shared by assembler unit tests and the mock upstream: mock
 * streams these exact bytes, unit tests feed them both whole and 1 byte at
 * a time to pin TCP-split invariance.
 */

const enc = new TextEncoder();

/** OpenAI stream: reasoning deltas, content deltas, one tool call across 3 chunk events, terminal usage, [DONE]. */
export const OPENAI_STREAM_WITH_USAGE: string =
  [
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Réfl"},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{"reasoning_content":"chissons"},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{"content":"Bonjour"},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"get_weather","arguments":"{\\"ci"}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"Pa"}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ris\\"}"}}]},"finish_reason":null}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
    `data: {"id":"chatcmpl-mock1","object":"chat.completion.chunk","created":1730000000,"model":"deepseek/deepseek-v4.1-flash","choices":[],"usage":{"prompt_tokens":1024,"completion_tokens":64,"completion_tokens_details":{"reasoning_tokens":12},"prompt_tokens_details":{"cached_tokens":512}}}`,
    `data: [DONE]`,
  ].join("\n\n") + "\n\n";

/** Same stream minus the terminal usage chunk (providers without include_usage support). */
export const OPENAI_STREAM_NO_USAGE: string = OPENAI_STREAM_WITH_USAGE.replace(
  /^data: \{[^\n]*"choices":\[\],"usage":[^\n]*\n\n/m,
  "",
);

/** Non-stream OpenAI response body. */
export const OPENAI_JSON_BODY: string = JSON.stringify({
  id: "chatcmpl-mock2",
  object: "chat.completion",
  created: 1730000000,
  model: "deepseek/deepseek-v4.1-flash",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Bonjour" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 1024,
    completion_tokens: 64,
    completion_tokens_details: { reasoning_tokens: 12 },
    prompt_tokens_details: { cached_tokens: 512 },
  },
});

/** Anthropic stream: thinking block, text block, one tool_use across 2 deltas, terminal usage, stop. */
export const ANTHROPIC_STREAM: string = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_mock1","type":"message","role":"assistant","model":"claude-sonnet-4","content":[],"stop_reason":null,"usage":{"input_tokens":100,"output_tokens":1}}}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Réfléchissons"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Bonjour"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":1}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_mock1","name":"get_weather","input":{}}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\\"Paris\\"}"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":2}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":42,"output_tokens_details":{"thinking_tokens":12}}}`,
  ``,
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  ``,
  ``,
].join("\n");

/** Non-stream Anthropic response body. */
export const ANTHROPIC_JSON_BODY: string = JSON.stringify({
  id: "msg_mock2",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4",
  content: [{ type: "text", text: "Bonjour" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 100,
    output_tokens: 9,
    output_tokens_details: { thinking_tokens: 3 },
  },
});

export function bytesOf(s: string): Uint8Array {
  return enc.encode(s);
}

/** Split into 1-byte chunks — worst-case TCP fragmentation. */
export function oneByteChunks(s: string): Uint8Array[] {
  const all = bytesOf(s);
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i++) out.push(all.subarray(i, i + 1));
  return out;
}
