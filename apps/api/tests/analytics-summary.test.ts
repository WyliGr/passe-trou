import { describe, expect, it } from "vitest";
import { adminHeaders, db, testApp } from "./setup.ts";

/**
 * GET /admin/analytics/summary (M2 T1) — grouped aggregate metrics over the
 * Request rows. Fixture seeds rows directly (no proxied traffic): 2 providers
 * (alpha, beta), 2 accounts (one per provider), 2 models, 2 keys, 2 members,
 * plus one row whose model is deleted afterwards (FK null / label null), one
 * status='error' with null ttft, and one 8-days-old row to prove the default
 * 7-day window boundaries.
 */

interface Metrics {
  requests: number;
  errors: number;
  errorRate: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  toolCalls: number;
  costUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgTtftMs: number | null;
  p95TtftMs: number | null;
}

interface Summary {
  from: string;
  to: string;
  groupBy: string;
  total: Metrics;
  rows: Array<{ key: string; label: string | null } & Metrics>;
}

async function summary(query = "", headers: Record<string, string> = adminHeaders()) {
  const res = await testApp().request(`/admin/analytics/summary${query}`, { headers });
  return res;
}

async function summaryOk(query = ""): Promise<Summary> {
  const res = await summary(query);
  expect(res.status).toBe(200);
  return (await res.json()) as Summary;
}

const ZERO_METRICS: Metrics = {
  requests: 0,
  errors: 0,
  errorRate: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  toolCalls: 0,
  costUsd: 0,
  avgLatencyMs: null,
  p95LatencyMs: null,
  avgTtftMs: null,
  p95TtftMs: null,
};

describe("GET /admin/analytics/summary — query params", () => {
  it("rejects an unknown groupBy with 400", async () => {
    const res = await summary("?groupBy=bogus");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: expect.any(String), message: expect.any(String) } });
  });

  it("rejects unparseable from/to with 400", async () => {
    expect((await summary("?from=nope")).status).toBe(400);
    expect((await summary("?to=2026-13-99T99:99")).status).toBe(400);
  });

  it("rejects from >= to with 400", async () => {
    const a = "2026-11-01T00:00:00.000Z";
    const b = "2026-11-02T00:00:00.000Z";
    expect((await summary(`?from=${b}&to=${a}`)).status).toBe(400);
    expect((await summary(`?from=${a}&to=${a}`)).status).toBe(400);
  });

  it("echoes groupBy and the resolved window", async () => {
    const body = await summaryOk(
      "?groupBy=member&from=2026-11-01T00:00:00Z&to=2026-11-03T12:00:00%2B02:00",
    );
    expect(body.groupBy).toBe("member");
    expect(body.from).toBe("2026-11-01T00:00:00.000Z");
    expect(body.to).toBe("2026-11-03T10:00:00.000Z");
  });
});

describe("GET /admin/analytics/summary — auth & empty shape", () => {
  it("rejects without an admin token (shared 401 error shape)", async () => {
    const res = await summary("", {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: expect.any(String), message: expect.any(String) } });
  });

  it("returns 200 with zeroed total and empty rows when no requests exist", async () => {
    const body = await summaryOk();
    expect(body.groupBy).toBe("provider");
    expect(body.rows).toEqual([]);
    expect(body.total).toEqual(ZERO_METRICS);
    expect(Object.keys(body).sort()).toEqual(["from", "groupBy", "rows", "to", "total"]);
    // default window: from ≈ to-7d, to ≈ now
    const from = Date.parse(body.from);
    const to = Date.parse(body.to);
    expect(to - from).toBe(7 * 24 * 3600 * 1000);
    expect(Math.abs(Date.now() - to)).toBeLessThan(10_000);
  });
});
