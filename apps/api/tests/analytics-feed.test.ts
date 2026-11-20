import { describe, expect, it } from "vitest";
import { feedBus, type FeedRow } from "../src/lib/feedBus.ts";
import { recordRequest } from "../src/proxy/capture.ts";
import { adminHeaders, db, testApp } from "./setup.ts";

/**
 * M2-T3: GET /admin/analytics/feed — live SSE feed of persisted request rows.
 * feedBus is a module-level EventEmitter singleton; capture.publish hooks at
 * the end of the capture write, fire-and-forget, subscriber errors swallowed.
 */

function sampleRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: "req_test_1",
    ts: new Date("2026-11-20T10:00:00.000Z"),
    requestedModel: "gpt-x",
    upstreamModel: "gpt-x-2026",
    wireFormat: "openai",
    stream: true,
    status: "ok",
    httpStatus: 200,
    latencyMs: 123,
    ttftMs: 45,
    promptTokens: 10,
    completionTokens: 20,
    costUsd: 0.001,
    keyId: "key_1",
    memberId: "mem_1",
    accountId: "acc_1",
    modelId: "mod_1",
    ...overrides,
  };
}

async function waitFor<T>(fn: () => T | Promise<T | null> | null, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("feedBus", () => {
  it("delivers published rows to subscribers, stops after unsubscribe", () => {
    const seen: FeedRow[] = [];
    const listener = (row: FeedRow) => seen.push(row);
    feedBus.subscribe(listener);
    feedBus.publish(sampleRow());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(sampleRow());

    feedBus.unsubscribe(listener);
    feedBus.publish(sampleRow({ id: "req_test_2" }));
    expect(seen).toHaveLength(1);
  });

  it("swallows a throwing subscriber and still reaches later subscribers", () => {
    const seen: FeedRow[] = [];
    const boom = () => {
      throw new Error("dashboard exploded");
    };
    const listener = (row: FeedRow) => seen.push(row);
    feedBus.subscribe(boom);
    feedBus.subscribe(listener);
    try {
      expect(() => feedBus.publish(sampleRow())).not.toThrow();
      expect(seen).toHaveLength(1);
    } finally {
      feedBus.unsubscribe(boom);
      feedBus.unsubscribe(listener);
    }
  });
});

describe("capture hook", () => {
  it("publishes the persisted row's fields after the insert succeeds", async () => {
    const seen: FeedRow[] = [];
    const listener = (row: FeedRow) => seen.push(row);
    feedBus.subscribe(listener);
    try {
      recordRequest(db, {
        key: null,
        model: null,
        mapping: null,
        wireFormat: "openai",
        stream: false,
        startedAt: Date.now(),
        httpStatus: 401,
        outcome: "error",
        errorCode: "unauthorized",
        requestedModel: "gpt-x",
      });

      const row = await waitFor(() => seen[0] ?? null);
      const persisted = await waitFor(async () => (await db.request.findFirst()) ?? null);

      expect(Object.keys(row).sort()).toEqual(
        [
          "id",
          "ts",
          "requestedModel",
          "upstreamModel",
          "wireFormat",
          "stream",
          "status",
          "httpStatus",
          "latencyMs",
          "ttftMs",
          "promptTokens",
          "completionTokens",
          "costUsd",
          "keyId",
          "memberId",
          "accountId",
          "modelId",
        ].sort(),
      );
      expect(row).toMatchObject({
        id: persisted.id,
        requestedModel: "gpt-x",
        upstreamModel: null,
        wireFormat: "openai",
        stream: false,
        status: "error",
        httpStatus: 401,
        ttftMs: null,
        promptTokens: null,
        completionTokens: null,
        costUsd: null,
        keyId: null,
        memberId: null,
        accountId: null,
        modelId: null,
      });
      expect(row.latencyMs).toBeGreaterThanOrEqual(0);
      expect(new Date(row.ts).getTime()).toBe(new Date(persisted.ts).getTime());
    } finally {
      feedBus.unsubscribe(listener);
    }
    // metrics only: no prompt/response content field may ever appear
    expect(JSON.stringify(seen[0])).not.toMatch(/content|messages|prompt["']?:/);
  });
});

/** Read the SSE body until `want` appears in the accumulated text (or deadline). */
async function readUntil(res: Response, want: string | RegExp, ms = 5000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`readUntil timeout waiting for ${want}: ${text}`)), ms),
        ),
      ]);
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (typeof want === "string" ? text.includes(want) : want.test(text)) return text;
    }
    throw new Error(`readUntil: stream ended without ${want}: ${JSON.stringify(text)}`);
  } finally {
    reader.releaseLock();
  }
}

function connect(path = "/admin/analytics/feed") {
  return testApp().request(path, { headers: adminHeaders() });
}

describe("GET /admin/analytics/feed", () => {
  it("401 without admin token, same unauthorized shape", async () => {
    const res = await testApp().request("/admin/analytics/feed");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(typeof body.error.message).toBe("string");
  });

  it("streams a hello event with exact SSE headers on connect", async () => {
    const res = await connect();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");

    const text = await readUntil(res, "event: hello\n");
    const match = text.match(/^event: hello\ndata: (.*)\n\n$/m)!;
    expect(match).not.toBeNull();
    const data = JSON.parse(match[1]!) as { ok: boolean; ts: string };
    expect(data.ok).toBe(true);
    expect(new Date(data.ts).toISOString()).toBe(data.ts);
    await res.body!.cancel();
  });

  it("sends a request event with the documented exact fields for each published row", async () => {
    const res = await connect();
    await readUntil(res, "event: hello\n");

    feedBus.publish(sampleRow());
    const text = await readUntil(res, "event: request\n");
    const match = text.match(/^event: request\ndata: (.*)\n\n$/m)!;
    const data = JSON.parse(match[1]!) as Record<string, unknown>;

    expect(Object.keys(data)).toEqual([
      "id",
      "ts",
      "requestedModel",
      "upstreamModel",
      "wireFormat",
      "stream",
      "status",
      "httpStatus",
      "latencyMs",
      "ttftMs",
      "promptTokens",
      "completionTokens",
      "costUsd",
      "keyId",
      "memberId",
      "accountId",
      "modelId",
    ]);
    expect(data).toEqual({
      ...sampleRow(),
      ts: "2026-11-20T10:00:00.000Z",
    });
    await res.body!.cancel();
  });
});
