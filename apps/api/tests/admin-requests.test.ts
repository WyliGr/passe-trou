import { describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { adminHeaders, db, testApp } from "./setup.ts";

/**
 * T2b: GET /admin/requests — paginated, filterable request log (metrics only,
 * no bodies exist). Newest-first via (ts DESC, id DESC); cursor = base64url
 * JSON {ts, id} of the last row returned; stable under concurrent inserts.
 */

interface RequestRow {
  id: string;
  ts: string;
  requestedModel: string;
  upstreamModel: string | null;
  wireFormat: string;
  stream: boolean;
  status: string;
  httpStatus: number;
  errorCode: string | null;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  toolCallCount: number | null;
  finishReason: string | null;
  costUsd: number | null;
  clientName: string | null;
  key: { id: string; label: string; prefix: string } | null;
  member: { id: string; name: string } | null;
  account: { id: string; displayName: string | null; provider: string } | null;
  model: { id: string; name: string } | null;
}
interface RequestsResponse {
  rows: RequestRow[];
  nextCursor: string | null;
}

async function list(query = "", headers?: Record<string, string>): Promise<{ status: number; body: RequestsResponse }> {
  headers = headers ?? (await adminHeaders());
  const res = await testApp().request(`/admin/requests${query}`, { headers });
  return { status: res.status, body: (await res.json()) as RequestsResponse };
}

async function makeReq(
  over: Partial<Parameters<Db["request"]["create"]>[0]["data"]> = {},
): Promise<{ id: string }> {
  return db.request.create({
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

const T0 = new Date("2025-06-01T00:00:00Z").getTime();
const at = (ms: number) => new Date(T0 + ms);

/** Create n rows 1s apart starting at T0; returns rows newest-first. */
async function makeSeries(n: number, over: Parameters<typeof makeReq>[0] = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(await makeReq({ ts: at(i * 1000), ...over }));
  return rows.reverse();
}

describe("GET /admin/requests", () => {
  it("rejects without admin token (401)", async () => {
    const res = await testApp().request("/admin/requests");
    expect(res.status).toBe(401);
  });

  it.each([
    "status=bogus",
    "stream=maybe",
    "minLatencyMs=abc",
    "minLatencyMs=-5",
    "limit=0",
    "limit=201",
    "limit=2.5",
    "from=not-a-date",
    "to=definitely-not",
    "cursor=%%%not-base64%%%",
    `cursor=${Buffer.from("not json").toString("base64url")}`,
    `cursor=${Buffer.from(JSON.stringify({ ts: "garbage", id: "x" })).toString("base64url")}`,
    `cursor=${Buffer.from(JSON.stringify({ id: "abc" })).toString("base64url")}`,
  ])("400 on invalid params: %s", async (q) => {
    const res = await testApp().request(`/admin/requests?${q}`, { headers: await adminHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns full documented row shape with resolved relations", async () => {
    const provider = await db.provider.create({ data: { name: "prov-1", kind: "openai" } });
    const account = await db.account.create({ data: { providerId: provider.id, label: "acc-label-1" } });
    const model = await db.model.create({ data: { name: "model-1" } });
    const member = await db.member.create({ data: { name: "Will" } });
    const key = await db.apiKey.create({
      data: { memberId: member.id, label: "agent", prefix: "pt_abcd1234", sha256: "sha-1" },
    });
    await makeReq({
      ts: at(0),
      keyId: key.id,
      memberId: member.id,
      accountId: account.id,
      modelId: model.id,
      requestedModel: "fast-flash",
      upstreamModel: "deepseek/deepseek-v4.1-flash",
      wireFormat: "anthropic",
      stream: true,
      status: "ok",
      httpStatus: 200,
      latencyMs: 1234,
      ttftMs: 321,
      promptTokens: 100,
      completionTokens: 50,
      reasoningTokens: 10,
      cachedTokens: 5,
      toolCallCount: 2,
      finishReason: "stop",
      costUsd: 0.000123,
      clientName: "heermes",
    });

    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    const r = body.rows[0];
    expect(r).toMatchObject({
      requestedModel: "fast-flash",
      upstreamModel: "deepseek/deepseek-v4.1-flash",
      wireFormat: "anthropic",
      stream: true,
      status: "ok",
      httpStatus: 200,
      errorCode: null,
      latencyMs: 1234,
      ttftMs: 321,
      promptTokens: 100,
      completionTokens: 50,
      reasoningTokens: 10,
      cachedTokens: 5,
      toolCallCount: 2,
      finishReason: "stop",
      clientName: "heermes",
    });
    expect(r.ts).toBe(at(0).toISOString());
    expect(r.costUsd).toBeCloseTo(0.000123, 9);
    expect(r.key).toEqual({ id: key.id, label: "agent", prefix: "pt_abcd1234" });
    expect(r.member).toEqual({ id: member.id, name: "Will" });
    expect(r.account).toEqual({ id: account.id, displayName: "acc-label-1", provider: "prov-1" });
    expect(r.model).toEqual({ id: model.id, name: "model-1" });
    // metrics-only contract: no content fields anywhere
    const keys = Object.keys(r);
    for (const forbidden of ["prompt", "response", "body", "messages", "content", "payload"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("SetNull'd relations serialize as documented nulls", async () => {
    await makeReq({ ts: at(0) });
    const { body } = await list();
    expect(body.rows[0].key).toBeNull();
    expect(body.rows[0].member).toBeNull();
    expect(body.rows[0].account).toBeNull();
    expect(body.rows[0].model).toBeNull();
  });

  it("default: 50 rows, newest first, nextCursor when more remain", async () => {
    const rows = await makeSeries(60);
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(50);
    expect(body.rows.map((r) => r.id)).toEqual(rows.slice(0, 50).map((r) => r.id));
    expect(body.nextCursor).not.toBeNull();
  });

  it("filters: from / to bound the ts window", async () => {
    const rows = await makeSeries(5); // ts = T0 + 0..4 s
    const { body } = await list(`?from=${at(1000).toISOString()}&to=${at(3000).toISOString()}`);
    expect(body.rows.map((r) => r.id).sort()).toEqual([rows[3].id, rows[2].id, rows[1].id].sort());
  });

  it("filters: keyId / memberId / modelId / accountId", async () => {
    const member = await db.member.create({ data: { name: "M" } });
    const key = await db.apiKey.create({ data: { memberId: member.id, label: "l", prefix: "pt_x", sha256: "s" } });
    const provider = await db.provider.create({ data: { name: "p", kind: "openai" } });
    const account = await db.account.create({ data: { providerId: provider.id, label: "a" } });
    const model = await db.model.create({ data: { name: "m" } });
    const hit = await makeReq({ ts: at(0), keyId: key.id, memberId: member.id, accountId: account.id, modelId: model.id });
    await makeReq({ ts: at(1000) });

    for (const q of [`keyId=${key.id}`, `memberId=${member.id}`, `accountId=${account.id}`, `modelId=${model.id}`]) {
      const { body } = await list(`?${q}`);
      expect(body.rows.map((r) => r.id)).toEqual([hit.id]);
    }
  });

  it("filters: status / stream / errorCode / minLatencyMs", async () => {
    const sErr = await makeReq({ ts: at(0), status: "error", errorCode: "upstream_429" });
    const sAbort = await makeReq({ ts: at(1000), status: "aborted" });
    const sStream = await makeReq({ ts: at(2000), stream: true });
    const sSlow = await makeReq({ ts: at(3000), latencyMs: 5000 });
    await makeReq({ ts: at(4000) });

    expect((await list("?status=error")).body.rows.map((r) => r.id)).toEqual([sErr.id]);
    expect((await list("?status=aborted")).body.rows.map((r) => r.id)).toEqual([sAbort.id]);
    expect((await list("?status=ok")).body.rows).toHaveLength(3);
    expect((await list("?stream=true")).body.rows.map((r) => r.id)).toEqual([sStream.id]);
    expect((await list("?stream=false")).body.rows).toHaveLength(4);
    expect((await list("?errorCode=upstream_429")).body.rows.map((r) => r.id)).toEqual([sErr.id]);
    expect((await list("?minLatencyMs=5000")).body.rows.map((r) => r.id)).toEqual([sSlow.id]);
  });

  it("combined filters intersect", async () => {
    const key = await db.apiKey.create({
      data: { memberId: (await db.member.create({ data: { name: "M" } })).id, label: "l", prefix: "pt_c", sha256: "sc" },
    });
    const hit = await makeReq({ ts: at(1000), keyId: key.id, status: "error", stream: true, latencyMs: 900 });
    await makeReq({ ts: at(2000), keyId: key.id, status: "error" }); // stream false
    await makeReq({ ts: at(3000), keyId: key.id, stream: true }); // status ok
    await makeReq({ ts: at(4000), status: "error", stream: true }); // other key

    const { body } = await list(`?keyId=${key.id}&status=error&stream=true&minLatencyMs=500`);
    expect(body.rows.map((r) => r.id)).toEqual([hit.id]);
  });

  it("paginates 3 pages with cursor round-trip; an insert mid-walk causes no dup/skip", async () => {
    const base = at(0);
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(await makeReq({ ts: new Date(base.getTime() + i) }));
    const expected = rows.map((r) => r.id).reverse(); // ts desc, id desc

    const seen: string[] = [];
    let q = "?limit=10";
    for (let page = 0; page < 3; page++) {
      const { status, body } = await list(q);
      expect(status).toBe(200);
      expect(body.rows).toHaveLength(10);
      seen.push(...body.rows.map((r) => r.id));
      if (page === 0) {
        // insert mid-walk: a NEWER row than everything seen → must not disturb the walk
        await makeReq({ ts: new Date(base.getTime() + 999999) });
      }
      expect(body.nextCursor).not.toBeNull();
      q = `?limit=10&cursor=${encodeURIComponent(body.nextCursor!)}`;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(30);

    // 4th page: nothing left from the original 30-window… but the mid-walk
    // row has ts newer than all cursors, so page 3 cursor (ts of row #29)
    // excludes it → empty page with null cursor.
    const tail = await list(q);
    expect(tail.body.rows).toHaveLength(0);
    expect(tail.body.nextCursor).toBeNull();
  });

  it("same-ts rows paginate by id tiebreak without dup/skip", async () => {
    const same = at(42_000);
    const rows = [];
    for (let i = 0; i < 7; i++) rows.push(await makeReq({ ts: same }));
    const expected = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1)).map((r) => r.id);

    const seen: string[] = [];
    let q = "?limit=3";
    let cursor: string | null = "x";
    while (cursor) {
      const { body } = await list(q);
      seen.push(...body.rows.map((r) => r.id));
      cursor = body.nextCursor;
      q = `?limit=3&cursor=${encodeURIComponent(cursor ?? "")}`;
      if (seen.length > 20) throw new Error("infinite pagination");
    }
    expect(seen).toEqual(expected);
  });

  it("limit edges: limit=1 returns one row + cursor; limit=200 accepted", async () => {
    await makeSeries(3);
    const one = await list("?limit=1");
    expect(one.body.rows).toHaveLength(1);
    expect(one.body.nextCursor).not.toBeNull();
    const big = await list("?limit=200");
    expect(big.body.rows).toHaveLength(3);
    expect(big.body.nextCursor).toBeNull();
  });
});
