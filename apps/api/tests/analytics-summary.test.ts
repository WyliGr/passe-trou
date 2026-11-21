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

async function summary(query = "", headers?: Record<string, string>) {
  headers = headers ?? (await adminHeaders());
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

/**
 * Seed the spanning fixture. Metrics chosen so every aggregate is exactly
 * assertable; R5 is 8 days old (outside the default 7d window);
 * R4's model is deleted after insert (FK null → group "none", label null);
 * R2 is an error row with null ttft and all-null metric fields.
 */
async function seedFixture() {
  const tag = crypto.randomUUID().slice(0, 8);
  const p1 = await db.provider.create({ data: { name: `alpha-${tag}`, kind: "openai" } });
  const p2 = await db.provider.create({ data: { name: `beta-${tag}`, kind: "openai" } });
  const a1 = await db.account.create({ data: { providerId: p1.id, label: `acct-a1-${tag}` } });
  const a2 = await db.account.create({ data: { providerId: p2.id, label: `acct-a2-${tag}` } });
  const mo1 = await db.model.create({ data: { name: `m-a-${tag}` } });
  const mo2 = await db.model.create({ data: { name: `m-b-${tag}` } });
  const moGone = await db.model.create({ data: { name: `m-gone-${tag}` } });
  const m1 = await db.member.create({ data: { name: `mem-a-${tag}` } });
  const m2 = await db.member.create({ data: { name: `mem-b-${tag}` } });
  const k1 = await db.apiKey.create({
    data: { memberId: m1.id, label: "heermes", prefix: `pt-${tag}`, sha256: `sha-k1-${tag}` },
  });
  const k2 = await db.apiKey.create({
    data: { memberId: m2.id, label: "vox", prefix: `pt-x${tag}`, sha256: `sha-k2-${tag}` },
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
  const base = { requestedModel: "x", upstreamModel: "x", wireFormat: "openai" as const, stream: true };
  await db.request.createMany({
    data: [
      { ...base, ts: hoursAgo(1), keyId: k1.id, memberId: m1.id, accountId: a1.id, modelId: mo1.id,
        status: "ok", httpStatus: 200, latencyMs: 100, ttftMs: 50,
        promptTokens: 1000, completionTokens: 500, reasoningTokens: 100, cachedTokens: 200,
        toolCallCount: 2, costUsd: 0.1 },
      { ...base, ts: hoursAgo(2), keyId: k1.id, memberId: m1.id, accountId: a1.id, modelId: mo2.id,
        status: "error", httpStatus: 500, errorCode: "upstream_error", latencyMs: 200, ttftMs: null },
      { ...base, ts: hoursAgo(3), keyId: k2.id, memberId: m2.id, accountId: a2.id, modelId: mo1.id,
        status: "ok", httpStatus: 200, latencyMs: 300, ttftMs: 150,
        promptTokens: 4000, completionTokens: 1000, toolCallCount: 1, costUsd: 0.3 },
      { ...base, ts: hoursAgo(4), keyId: k1.id, memberId: m1.id, accountId: a1.id, modelId: moGone.id,
        status: "ok", httpStatus: 200, latencyMs: 400, ttftMs: 10,
        promptTokens: 100, completionTokens: 50, reasoningTokens: 0, cachedTokens: 0,
        toolCallCount: 0, costUsd: 0.01 },
      { ...base, ts: hoursAgo(8 * 24), keyId: k2.id, memberId: m2.id, accountId: a2.id, modelId: mo1.id,
        status: "ok", httpStatus: 200, latencyMs: 500, ttftMs: 200,
        promptTokens: 5000, completionTokens: 5000, costUsd: 0.07 },
    ],
  });
  await db.model.delete({ where: { id: moGone.id } }); // FK SetNull on R4

  return { tag, p1, p2, a1, a2, mo1, mo2, m1, m2, k1, k2 };
}

describe("GET /admin/analytics/summary — provider axis, exact metrics", () => {
  it("aggregates per provider over the default window (8-day-old row excluded)", async () => {
    const f = await seedFixture();
    const body = await summaryOk();

    expect(body.total).toMatchObject({
      requests: 4,
      errors: 1,
      errorRate: 0.25,
      promptTokens: 5100,
      completionTokens: 1550,
      reasoningTokens: 100,
      cachedTokens: 200,
      toolCalls: 3,
      costUsd: 0.41,
      avgLatencyMs: 250,
      avgTtftMs: 70,
    });
    expect(body.total.p95LatencyMs).toBeCloseTo(385, 6); // 300 + .85*(400-300)
    expect(body.total.p95TtftMs).toBeCloseTo(140, 6); // 50 + .9*(150-50)

    expect(body.rows).toHaveLength(2);
    // costUsd desc: beta (0.30) before alpha (0.11)
    expect(body.rows[0]!.key).toBe(f.p2.id);
    expect(body.rows[1]!.key).toBe(f.p1.id);

    const alpha = body.rows[1]!;
    expect(alpha.label).toBe(f.p1.name);
    expect(alpha).toMatchObject({
      requests: 3,
      errors: 1,
      errorRate: 0.3333,
      promptTokens: 1100,
      completionTokens: 550,
      reasoningTokens: 100,
      cachedTokens: 200,
      toolCalls: 2,
      costUsd: 0.11,
      avgTtftMs: 30,
    });
    expect(alpha.avgLatencyMs).toBeCloseTo(233.333333, 4);
    expect(alpha.p95LatencyMs).toBeCloseTo(380, 6); // 200 + .9*(400-200)
    expect(alpha.p95TtftMs).toBeCloseTo(48, 6); // 10 + .95*(50-10)

    const beta = body.rows[0]!;
    expect(beta.label).toBe(f.p2.name);
    expect(beta).toMatchObject({
      requests: 1,
      errors: 0,
      errorRate: 0,
      promptTokens: 4000,
      completionTokens: 1000,
      reasoningTokens: 0,
      cachedTokens: 0,
      toolCalls: 1,
      costUsd: 0.3,
      avgLatencyMs: 300,
      p95LatencyMs: 300,
      avgTtftMs: 150,
      p95TtftMs: 150,
    });
  });
});

describe("GET /admin/analytics/summary — account/model/key/member axes", () => {
  it("groups by account with account labels", async () => {
    const f = await seedFixture();
    const body = await summaryOk("?groupBy=account");
    expect(body.rows.map((r) => r.key)).toEqual([f.a2.id, f.a1.id]);
    expect(body.rows[0]!.label).toBe(f.a2.label);
    expect(body.rows[1]!.label).toBe(f.a1.label);
    expect(body.rows[1]).toMatchObject({ requests: 3, errors: 1, costUsd: 0.11 });
    expect(body.rows[0]).toMatchObject({ requests: 1, errors: 0, costUsd: 0.3 });
  });

  it("groups by model: deleted model collapses to key 'none' with null label", async () => {
    const f = await seedFixture();
    const body = await summaryOk("?groupBy=model");
    expect(body.rows.map((r) => r.key)).toEqual([f.mo1.id, "none", f.mo2.id]);
    const [mo1Row, goneRow, mo2Row] = body.rows as [Summary["rows"][0], Summary["rows"][0], Summary["rows"][0]];
    expect(mo1Row.label).toBe(f.mo1.name);
    expect(mo1Row).toMatchObject({ requests: 2, errors: 0, costUsd: 0.4, avgLatencyMs: 200 });
    expect(goneRow.label).toBeNull(); // FK row deleted after insert
    expect(goneRow).toMatchObject({ requests: 1, costUsd: 0.01 });
    expect(mo2Row.label).toBe(f.mo2.name);
    expect(mo2Row).toMatchObject({ requests: 1, errors: 1, errorRate: 1, avgTtftMs: null });
  });

  it("groups by key with 'label (prefix)' rendering", async () => {
    const f = await seedFixture();
    const body = await summaryOk("?groupBy=key");
    expect(body.rows.map((r) => r.key)).toEqual([f.k2.id, f.k1.id]);
    expect(body.rows[0]!.label).toBe(`vox (pt-x${f.tag})`);
    expect(body.rows[1]!.label).toBe(`heermes (pt-${f.tag})`);
    expect(body.rows[1]).toMatchObject({ requests: 3, toolCalls: 2 });
  });

  it("groups by member with member names", async () => {
    const f = await seedFixture();
    const body = await summaryOk("?groupBy=member");
    expect(body.rows.map((r) => r.key)).toEqual([f.m2.id, f.m1.id]);
    expect(body.rows[0]!.label).toBe(f.m2.name);
    expect(body.rows[1]!.label).toBe(f.m1.name);
    expect(body.rows[1]).toMatchObject({ requests: 3, errors: 1, cachedTokens: 200 });
  });
});

describe("GET /admin/analytics/summary — window boundaries", () => {
  it("zeroes the total and returns no rows for an empty range", async () => {
    await seedFixture();
    const body = await summaryOk("?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z");
    expect(body.total).toEqual(ZERO_METRICS);
    expect(body.rows).toEqual([]);
  });

  it("an explicit 30d window also covers the 8-day-old row", async () => {
    const f = await seedFixture();
    const from = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const to = new Date().toISOString();
    const body = await summaryOk(`?from=${from}&to=${to}`);
    expect(body.total.requests).toBe(5);
    const beta = body.rows.find((r) => r.key === f.p2.id)!;
    expect(beta).toMatchObject({ requests: 2, costUsd: 0.37 });
  });
});

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
