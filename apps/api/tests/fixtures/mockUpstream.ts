import type { ServerType } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  ANTHROPIC_JSON_BODY,
  ANTHROPIC_STREAM,
  OPENAI_JSON_BODY,
  OPENAI_STREAM_NO_USAGE,
  OPENAI_STREAM_WITH_USAGE,
} from "./streams.ts";

/**
 * Mock upstream on an ephemeral localhost port. Never talks to real providers.
 * Behavior is keyed on the `model` the proxy forwards in the request body:
 *   contains "rate-limited" → instant 429 with Retry-After: 45
 *   contains "broken"       → instant 500
 *   contains "delayed"      → 150 ms latency before a normal answer
 *   contains "no-usage"     → stream without the terminal usage chunk
 * Everything else: stream:true → canned SSE, else canned JSON for the wire.
 */
export interface MockRequest {
  path: string;
  model: string | undefined;
  stream: boolean;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface MockUpstream {
  url: string;
  requests: MockRequest[];
  close: () => Promise<void>;
}

const WIRE_HEADERS: Record<string, string> = {
  openai: "text/event-stream",
  anthropic: "text/event-stream",
};

export async function startMockUpstream(): Promise<MockUpstream> {
  const requests: MockRequest[] = [];
  const app = new Hono();

  const record = async (c: { req: { path: string; raw: Request } }) => {
    const body = (await c.req.raw.json()) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const entry: MockRequest = {
      path: c.req.path,
      model: typeof body.model === "string" ? body.model : undefined,
      stream: body.stream === true,
      headers,
      body,
    };
    requests.push(entry);
    return entry;
  };

  const early = async (entry: MockRequest): Promise<Response | null> => {
    const model = entry.model ?? "";
    if (model.includes("rate-limited")) {
      return Response.json(
        { error: { message: "rate limited upstream", type: "rate_limit_error" } },
        { status: 429, headers: { "retry-after": "45" } },
      );
    }
    if (model.includes("broken")) {
      return Response.json({ error: { message: "upstream exploded" } }, { status: 500 });
    }
    if (model.includes("delayed")) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  };

  app.post("/chat/completions", async (c) => {
    const entry = await record(c);
    const earlyRes = await early(entry);
    if (earlyRes) return earlyRes;
    if (entry.stream) {
      const body = (entry.model ?? "").includes("no-usage")
        ? OPENAI_STREAM_NO_USAGE
        : OPENAI_STREAM_WITH_USAGE;
      return new Response(body, {
        status: 200,
        headers: { "content-type": WIRE_HEADERS.openai! },
      });
    }
    return new Response(OPENAI_JSON_BODY, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  app.post("/messages", async (c) => {
    const entry = await record(c);
    const earlyRes = await early(entry);
    if (earlyRes) return earlyRes;
    if (entry.stream) {
      return new Response(ANTHROPIC_STREAM, {
        status: 200,
        headers: { "content-type": WIRE_HEADERS.anthropic! },
      });
    }
    return new Response(ANTHROPIC_JSON_BODY, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const { server, port } = await new Promise<{ server: ServerType; port: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
      resolve({ server: s as ServerType, port: info.port }),
    );
  });

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => (err ? reject(err) : resolve()));
      }),
  };
}
