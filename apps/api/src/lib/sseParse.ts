/**
 * Incremental SSE parser (RFC EventSource wire format), hand-rolled: no deps.
 * Correct under arbitrary TCP chunk splits and coalescing — bytes are decoded
 * with a streaming TextDecoder, lines buffered until a terminator arrives,
 * events dispatched on blank lines. `data: [DONE]` is emitted like any other
 * event; the caller decides it is terminal.
 */

export interface SSEEvent {
  /** `event:` field; absent when the server did not name the event. */
  event?: string;
  /** `data:` lines joined with \n, per spec. */
  data: string;
}

export type SSEHandler = (event: SSEEvent) => void;

const CR = 0x0d;

/**
 * Returns a `feed(chunk)` function. Feed raw bytes in any fragmentation;
 * complete events fire synchronously from within feed.
 */
export function parseSSE(onEvent: SSEHandler): (chunk: Uint8Array) => void {
  const decoder = new TextDecoder();
  let lineBuf = "";
  let dataLines: string[] = [];
  let eventName: string | undefined;

  const dispatch = (): void => {
    if (dataLines.length === 0) {
      // Comment-only or empty block: resets event name, emits nothing.
      eventName = undefined;
      return;
    }
    const ev: SSEEvent = { data: dataLines.join("\n") };
    if (eventName !== undefined) ev.event = eventName;
    onEvent(ev);
    dataLines = [];
    eventName = undefined;
  };

  const line = (raw: string): void => {
    if (raw === "") return dispatch();
    if (raw.startsWith(":")) return; // comment / keep-alive
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value || undefined;
    // id / retry and unknown fields carry no proxy meaning: dropped.
  };

  return (chunk: Uint8Array) => {
    const text = lineBuf + decoder.decode(chunk, { stream: true });
    const parts = text.split("\n");
    lineBuf = parts.pop() ?? "";
    for (let p of parts) {
      if (p.charCodeAt(p.length - 1) === CR) p = p.slice(0, -1);
      line(p);
    }
  };
}
