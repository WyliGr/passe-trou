import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, generateApiKey } from "../src/lib/crypto.ts";
import { clearPriceCache } from "../src/proxy/capture.ts";
import { startMockUpstream, type MockUpstream } from "./fixtures/mockUpstream.ts";
import { adminHeaders, db, testApp, TEST_MASTER_KEY } from "./setup.ts";

/**
 * Task 14: GET /admin/overview — entity counts, today's aggregates (UTC
 * midnight boundary), and per-account today stats, all computed live from
 * Request rows. Fixture: 1 provider, 2 accounts, 2 models; 3 proxied
 * requests against the mock upstream distribute M1→A, M1→B (least-used),
 * M2→A. Costs from seeded prices (Task 7 semantics).
 */

let mock: MockUpstream;

beforeAll(async () => {
  mock = await startMockUpstream();
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  clearPriceCache();
});

const UPSTREAM_CRED = "upstream-test-credential-0000";

interface Overview {
  counts: { providers: number; accounts: number; models: number; members: number; keys: number };
  today: { requests: number; tokensIn: number; tokensOut: number; costUsd: number };
  accounts: Array<{
    id: string;
    label: string;
    provider: string;
    enabled: boolean;
    cooling: boolean;
    todayRequests: number;
    todayCostUsd: number;
  }>;
}

async function waitFor<T>(fn: () => Promise<T | null>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function overview(): Promise<Overview> {
  const res = await testApp().request("/admin/overview", { headers: adminHeaders() });
  expect(res.status).toBe(200);
  return (await res.json()) as Overview;
}

async function chat(token: string, model: string, stream: boolean) {
  const res = await testApp().request("/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(res.status).toBe(200);
  await res.text();
}

describe("GET /admin/overview", () => {
  it("counts + today aggregates + per-account stats from 3 proxied requests (2 models, 2 accounts)", async () => {
    // --- seed: provider, 2 accounts, member + key (wildcard allowlist), 2 models, 3 mappings
    const provider = await db.provider.create({
      data: { name: `CommandCode ${crypto.randomUUID()}`, kind: "openai", baseUrl: mock.url },
    });
    const makeAccount = async (label: string) => {
      const account = await db.account.create({ data: { providerId: provider.id, label } });
      await db.accountCredential.create({
        data: {
          accountId: account.id,
          enc: encryptSecret(UPSTREAM_CRED, TEST_MASTER_KEY),
          keyPrefix: "upstream-",
          last4: "0000",
        },
      });
      return account;
    };
    const accA = await makeAccount(`compte-a-${crypto.randomUUID().slice(0, 8)}`);
    const accB = await makeAccount(`compte-b-${crypto.randomUUID().slice(0, 8)}`);
    const member = await db.member.create({ data: { name: `Will ${crypto.randomUUID()}` } });
    const { token, keyPrefix, keyHash } = generateApiKey();
    await db.apiKey.create({ data: { memberId: member.id, label: "agent", prefix: keyPrefix, sha256: keyHash } });
    const model1 = await db.model.create({ data: { name: `m1-${crypto.randomUUID().slice(0, 8)}` } });
    const model2 = await db.model.create({ data: { name: `m2-${crypto.randomUUID().slice(0, 8)}` } });
    await db.modelAccount.create({
      data: { modelId: model1.id, accountId: accA.id, upstreamModel: "big-usage-model" },
    });
    await db.modelAccount.create({
      data: { modelId: model1.id, accountId: accB.id, upstreamModel: "big-usage-model-b" },
    });
    await db.modelAccount.create({
      data: { modelId: model2.id, accountId: accA.id, upstreamModel: "deepseek/deepseek-v4.1-flash" },
    });

    // --- prices: account-exact for both big-usage mappings (→ 0.275 each),
    //     provider glob for deepseek (1024 @0.14 + 64 @0.28 = 0.00016128)
    await db.price.create({
      data: { accountId: accA.id, modelMatcher: "big-usage-model", priceInput: 0.1, priceOutput: 0.2, priceCachedInput: 0.05 },
    });
    await db.price.create({
      data: { accountId: accB.id, modelMatcher: "big-usage-model-b", priceInput: 0.1, priceOutput: 0.2, priceCachedInput: 0.05 },
    });
    await db.price.create({
      data: { providerId: provider.id, modelMatcher: "deepseek/*", priceInput: 0.14, priceOutput: 0.28 },
    });
    clearPriceCache();

    // --- 3 proxied requests: M1→A (tie → first), M1→B (least-used), M2→A
    await chat(token, model1.name, true);
    await chat(token, model1.name, true);
    await chat(token, model2.name, false);

    await waitFor(async () => ((await db.request.count()) === 3 ? true : null));

    const body = await overview();
    expect(Object.keys(body)).toEqual(["counts", "today", "accounts"]);
    expect(body.counts).toEqual({ providers: 1, accounts: 2, models: 2, members: 1, keys: 1 });
    expect(body.today.requests).toBe(3);
    expect(body.today.tokensIn).toBe(1_000_000 + 1_000_000 + 1024);
    expect(body.today.tokensOut).toBe(1_000_000 + 1_000_000 + 64);
    const expectedTotal = 0.275 + 0.275 + (1024 * 0.14 + 64 * 0.28) / 1_000_000;
    expect(body.today.costUsd).toBeCloseTo(expectedTotal, 6);

    expect(body.accounts).toHaveLength(2);
    const rowA = body.accounts.find((a) => a.id === accA.id)!;
    const rowB = body.accounts.find((a) => a.id === accB.id)!;
    expect(rowA).toMatchObject({
      label: accA.label,
      provider: provider.name,
      enabled: true,
      cooling: false,
      todayRequests: 2,
    });
    expect(rowA.todayCostUsd).toBeCloseTo(0.275 + (1024 * 0.14 + 64 * 0.28) / 1_000_000, 6);
    expect(rowB).toMatchObject({
      label: accB.label,
      provider: provider.name,
      enabled: true,
      cooling: false,
      todayRequests: 1,
    });
    expect(rowB.todayCostUsd).toBeCloseTo(0.275, 6);
  });

  it("cooling reflects Account.cooledDownUntil in the future", async () => {
    const provider = await db.provider.create({
      data: { name: `P ${crypto.randomUUID()}`, kind: "openai", baseUrl: mock.url },
    });
    const account = await db.account.create({
      data: { providerId: provider.id, label: "compte-x" },
    });
    let body = await overview();
    expect(body.accounts.find((a) => a.id === account.id)!.cooling).toBe(false);

    await db.account.update({
      where: { id: account.id },
      data: { cooledDownUntil: new Date(Date.now() + 3600_000) },
    });
    body = await overview();
    const row = body.accounts.find((a) => a.id === account.id)!;
    expect(row.cooling).toBe(true);
    expect(row.todayRequests).toBe(0);
    expect(row.todayCostUsd).toBe(0);
  });
});
