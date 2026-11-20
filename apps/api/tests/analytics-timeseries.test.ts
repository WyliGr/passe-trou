import { describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { adminHeaders, db, testApp } from "./setup.ts";

/**
 * T2a: GET /admin/analytics/timeseries — bucketed request/token/cost/latency
 * metrics over a from..to UTC window, zero-filled via generate_series,
 * optionally grouped by provider/account/model/key/member.
 * Fixtures insert Request rows directly with explicit ts; windows are fixed
 * historical dates so bucket arithmetic is deterministic.
 */

interface ValuePoint {
  ts: string;
  value: number;
}
interface LatencyPoint {
  ts: string;
  avg: number | null;
  p95: number | null;
}
interface Series<P> {
  key: string;
  label: string | null;
  points: P[];
}
interface TimeseriesResponse {
  from: string;
  to: string;
  bucket: "hour" | "day";
  metric: string;
  series: Series<ValuePoint | LatencyPoint>[];
}

async function timeseries(query = ""): Promise<{ status: number; body: TimeseriesResponse }> {
  const res = await testApp().request(`/admin/analytics/timeseries${query}`, {
    headers: adminHeaders(),
  });
  return { status: res.status, body: (await res.json()) as TimeseriesResponse };
}

let uid = 0;
async function baseFixture(): Promise<{
  provider: { id: string; name: string };
  accA: { id: string; label: string };
  accB: { id: string; label: string };
  modelA: { id: string; name: string };
  modelB: { id: string; name: string };
  member: { id: string; name: string };
  key: { id: string; label: string; prefix: string };
}> {
  uid += 1;
  const provider = await db.provider.create({ data: { name: `cc-${uid}`, kind: "openai" } });
  const accA = await db.account.create({ data: { providerId: provider.id, label: `acc-a-${uid}` } });
  const accB = await db.account.create({ data: { providerId: provider.id, label: `acc-b-${uid}` } });
  const modelA = await db.model.create({ data: { name: `model-a-${uid}` } });
  const modelB = await db.model.create({ data: { name: `model-b-${uid}` } });
  const member = await db.member.create({ data: { name: `will-${uid}` } });
  const key = await db.apiKey.create({
    data: { memberId: member.id, label: `agent-${uid}`, prefix: `pt_pre${uid.toString().padStart(4, "0")}`, sha256: `sha-${uid}` },
  });
  return { provider, accA, accB, modelA, modelB, member, key };
}

async function makeReq(
  dbClient: Db,
  over: Partial<Parameters<Db["request"]["create"]>[0]["data"]> & { ts: Date },
) {
  return dbClient.request.create({
    data: {
      requestedModel: "req-model",
      wireFormat: "openai",
      stream: false,
      status: "ok",
      httpStatus: 200,
      latencyMs: 100,
      ...over,
    },
  });
}

describe("GET /admin/analytics/timeseries", () => {
  it("rejects without admin token (401)", async () => {
    const res = await testApp().request("/admin/analytics/timeseries");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it.each([
    "metric=bogus",
    "bucket=minute",
    "from=not-a-date",
    "to=2025-13-40T99:99:99Z",
    "groupBy=tenant",
    "from=2025-01-02T00:00:00Z&to=2025-01-01T00:00:00Z",
  ])("400 on invalid params: %s", async (q) => {
    const res = await testApp().request(`/admin/analytics/timeseries?${q}`, { headers: adminHeaders() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBeDefined();
  });

  it("default window: hour buckets over the last 24h, single 'all' series, zero-filled", async () => {
    const { status, body } = await timeseries();
    expect(status).toBe(200);
    expect(body.bucket).toBe("hour");
    expect(body.metric).toBe("requests");
    expect(body.series).toHaveLength(1);
    expect(body.series[0].key).toBe("all");
    expect(body.series[0].label).toBeNull();
    // date_trunc(from)..date_trunc(to) inclusive = 25 hour buckets
    expect(body.series[0].points).toHaveLength(25);
    for (const p of body.series[0].points) {
      expect(p).toHaveProperty("value", 0);
    }
    expect(new Date(body.from).toISOString()).toBe(body.from);
    expect(new Date(body.to).toISOString()).toBe(body.to);
  });

  it("default day window: 31 buckets", async () => {
    const { body } = await timeseries("?bucket=day");
    expect(body.series[0].points).toHaveLength(31);
  });

  it("hour buckets: alignment by date_trunc, explicit zeros in gaps", async () => {
    const f = await baseFixture();
    await makeReq(db, { ts: new Date("2025-01-01T01:05:00Z"), accountId: f.accA.id });
    await makeReq(db, { ts: new Date("2025-01-01T01:55:00Z"), accountId: f.accA.id });
    await makeReq(db, { ts: new Date("2025-01-01T03:10:00Z"), accountId: f.accA.id });
    // outside the window: must not be counted
    await makeReq(db, { ts: new Date("2024-12-31T23:59:59Z"), accountId: f.accA.id });

    const { status, body } = await timeseries("?from=2025-01-01T00:23:00Z&to=2025-01-01T03:47:00Z&bucket=hour");
    expect(status).toBe(200);
    const points = body.series[0].points as ValuePoint[];
    expect(points.map((p) => p.ts)).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T01:00:00.000Z",
      "2025-01-01T02:00:00.000Z",
      "2025-01-01T03:00:00.000Z",
    ]);
    expect(points.map((p) => p.value)).toEqual([0, 2, 0, 1]);
  });

  it("day buckets: alignment + zero-fill", async () => {
    await makeReq(db, { ts: new Date("2025-01-02T09:30:00Z") });
    await makeReq(db, { ts: new Date("2025-01-04T00:00:01Z") });
    await makeReq(db, { ts: new Date("2025-01-04T23:59:59Z") });

    const { body } = await timeseries("?from=2025-01-01T06:00:00Z&to=2025-01-05T12:00:00Z&bucket=day");
    const points = body.series[0].points as ValuePoint[];
    expect(points.map((p) => p.ts)).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-01-02T00:00:00.000Z",
      "2025-01-03T00:00:00.000Z",
      "2025-01-04T00:00:00.000Z",
      "2025-01-05T00:00:00.000Z",
    ]);
    expect(points.map((p) => p.value)).toEqual([0, 1, 0, 2, 0]);
  });

  it("tokens metric: prompt+completion sum, null tokens count as 0", async () => {
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), promptTokens: 10, completionTokens: 5 });
    await makeReq(db, { ts: new Date("2025-01-01T01:30:00Z"), promptTokens: 3, completionTokens: null });
    await makeReq(db, { ts: new Date("2025-01-01T02:10:00Z"), promptTokens: null, completionTokens: null });

    const { body } = await timeseries("?metric=tokens&from=2025-01-01T00:00:00Z&to=2025-01-01T04:00:00Z");
    const points = body.series[0].points as ValuePoint[];
    expect(points.map((p) => p.value)).toEqual([0, 18, 0, 0, 0]);
  });

  it("cost metric: costUsd sum rounded to 6 decimals, nulls skipped", async () => {
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), costUsd: 0.0000011 });
    await makeReq(db, { ts: new Date("2025-01-01T01:20:00Z"), costUsd: 0.0000012 });
    await makeReq(db, { ts: new Date("2025-01-01T01:40:00Z"), costUsd: null });

    const { body } = await timeseries("?metric=cost&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    const points = body.series[0].points as ValuePoint[];
    expect(points.map((p) => p.value)).toEqual([0, 0.000002, 0]);
  });

  it("latency metric: points carry avg+p95, no value; empty buckets are nulls", async () => {
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), latencyMs: 100 });
    await makeReq(db, { ts: new Date("2025-01-01T01:20:00Z"), latencyMs: 200 });
    await makeReq(db, { ts: new Date("2025-01-01T01:40:00Z"), latencyMs: 300 });

    const { body } = await timeseries("?metric=latency&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    const points = body.series[0].points as LatencyPoint[];
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ ts: "2025-01-01T00:00:00.000Z", avg: null, p95: null });
    expect(points[1].avg).toBeCloseTo(200, 6);
    // percentile_cont(0.95) over [100,200,300] interpolates: 200 + 0.9*100
    expect(points[1].p95).toBeCloseTo(290, 6);
    expect(points[1]).not.toHaveProperty("value");
    expect(points[2]).toEqual({ ts: "2025-01-01T02:00:00.000Z", avg: null, p95: null });
  });

  it("groupBy=model: one series per model, labels resolved, sorted by total desc, null FK under key 'none'", async () => {
    const f = await baseFixture();
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), modelId: f.modelA.id });
    await makeReq(db, { ts: new Date("2025-01-01T01:10:00Z"), modelId: f.modelA.id });
    await makeReq(db, { ts: new Date("2025-01-01T02:00:00Z"), modelId: f.modelB.id });
    await makeReq(db, { ts: new Date("2025-01-01T02:30:00Z"), modelId: null });

    const { body } = await timeseries("?groupBy=model&from=2025-01-01T00:00:00Z&to=2025-01-01T03:00:00Z");
    expect(body.series).toHaveLength(3);
    const [sA, sB, sNone] = body.series;
    expect(sA).toMatchObject({ key: f.modelA.id, label: f.modelA.name });
    expect(sA.points.map((p) => (p as ValuePoint).value)).toEqual([0, 2, 0, 0]);
    expect(sB).toMatchObject({ key: f.modelB.id, label: f.modelB.name });
    expect(sB.points.map((p) => (p as ValuePoint).value)).toEqual([0, 0, 1, 0]);
    expect(sNone).toMatchObject({ key: "none", label: null });
    expect(sNone.points.map((p) => (p as ValuePoint).value)).toEqual([0, 0, 1, 0]);
  });

  it("groupBy=account: label = account label, totals desc", async () => {
    const f = await baseFixture();
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), accountId: f.accB.id });
    await makeReq(db, { ts: new Date("2025-01-01T01:10:00Z"), accountId: f.accB.id });
    await makeReq(db, { ts: new Date("2025-01-01T01:20:00Z"), accountId: f.accA.id });

    const { body } = await timeseries("?groupBy=account&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    expect(body.series).toHaveLength(2);
    expect(body.series[0]).toMatchObject({ key: f.accB.id, label: f.accB.label });
    expect(body.series[1]).toMatchObject({ key: f.accA.id, label: f.accA.label });
    expect(body.series[0].points.map((p) => (p as ValuePoint).value)).toEqual([0, 2, 0]);
  });

  it("groupBy=provider: label = provider name", async () => {
    const f = await baseFixture();
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), accountId: f.accA.id });
    await makeReq(db, { ts: new Date("2025-01-01T01:10:00Z"), accountId: f.accB.id });

    const { body } = await timeseries("?groupBy=provider&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ key: f.provider.id, label: f.provider.name });
    expect(body.series[0].points.map((p) => (p as ValuePoint).value)).toEqual([0, 2, 0]);
  });

  it("groupBy=key: label = prefix + label", async () => {
    const f = await baseFixture();
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), keyId: f.key.id });

    const { body } = await timeseries("?groupBy=key&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    expect(body.series).toHaveLength(1);
    expect(body.series[0].key).toBe(f.key.id);
    expect(body.series[0].label).toBe(`${f.key.prefix} ${f.key.label}`);
  });

  it("groupBy=member: label = member name", async () => {
    const f = await baseFixture();
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), memberId: f.member.id });

    const { body } = await timeseries("?groupBy=member&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ key: f.member.id, label: f.member.name });
  });

  it("buckets stay UTC-aligned even when the DB session TimeZone is non-UTC", async () => {
    const { createPrismaClient } = await import("../src/db.ts");
    const { testDatabaseUrl } = await import("./setup.ts");
    // Session pinned to a negative-offset zone: without an explicit UTC pin,
    // date_trunc(day) would land buckets on 05:00Z.
    const weirdDb = createPrismaClient(`${testDatabaseUrl()}?options=-c%20TimeZone%3DAmerica%2FNew_York`);
    // Insert via the normal (UTC-session) client so the row is a true
    // 2025-01-02T02:30Z instant; the NY-session query must still bucket it
    // under 2025-01-02T00:00Z.
    await makeReq(db, { ts: new Date("2025-01-02T02:30:00Z") });
    const res = await testApp({ db: weirdDb }).request(
      "/admin/analytics/timeseries?bucket=day&from=2025-01-01T06:00:00Z&to=2025-01-03T23:00:00Z",
      { headers: adminHeaders() },
    );
    const body = (await res.json()) as TimeseriesResponse;
    expect(body.series[0].points.map((p) => p.ts)).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-01-02T00:00:00.000Z",
      "2025-01-03T00:00:00.000Z",
    ]);
    expect(body.series[0].points.map((p) => (p as ValuePoint).value)).toEqual([0, 1, 0]);
  });

  it("400 when the window spans an excessive number of buckets", async () => {
    const res = await testApp().request(
      "/admin/analytics/timeseries?bucket=hour&from=2020-01-01T00:00:00Z&to=2025-01-01T00:00:00Z",
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(400);
  });

  it("tokens metric: sums beyond int4 range return as numbers", async () => {
    await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), promptTokens: 2_000_000_000, completionTokens: 2_000_000_000 });
    await makeReq(db, { ts: new Date("2025-01-01T01:30:00Z"), promptTokens: 2_000_000_000, completionTokens: null });
    const { body } = await timeseries("?metric=tokens&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    expect((body.series[0].points[1] as ValuePoint).value).toBe(6_000_000_000);
  });

  it("grouped series capped at 25", async () => {
    const models = [];
    for (let i = 0; i < 30; i++) {
      models.push(await db.model.create({ data: { name: `cap-m${i}-${crypto.randomUUID().slice(0, 6)}` } }));
    }
    for (const m of models) {
      await makeReq(db, { ts: new Date("2025-01-01T01:00:00Z"), modelId: m.id });
    }
    const { body } = await timeseries("?groupBy=model&from=2025-01-01T00:00:00Z&to=2025-01-01T02:00:00Z");
    expect(body.series).toHaveLength(25);
  });
});
