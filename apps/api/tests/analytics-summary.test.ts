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
