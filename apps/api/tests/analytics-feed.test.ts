import { describe, expect, it } from "vitest";
import { feedBus, type FeedRow } from "../src/lib/feedBus.ts";
import { recordRequest } from "../src/proxy/capture.ts";
import { db } from "./setup.ts";

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
