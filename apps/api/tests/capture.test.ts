import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, generateApiKey } from "../src/lib/crypto.ts";
import { clearPriceCache } from "../src/proxy/capture.ts";
import { startMockUpstream, type MockUpstream } from "./fixtures/mockUpstream.ts";
import { db, testApp, TEST_MASTER_KEY } from "./setup.ts";

/**
 * Task 12 capture matrix: through the real proxy against the mock upstream,
 * every terminal path persists exactly one requests row.
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

interface SeedOpts {
  upstreamModels: string[];
  logicalModel?: string;
  wire?: "openai" | "anthropic";
}

async function seedProxyStack(opts: SeedOpts) {
  const member = await db.member.create({ data: { name: `Will ${crypto.randomUUID()}` } });
  const { token, keyPrefix, keyHash } = generateApiKey();
  const key = await db.apiKey.create({
    data: { memberId: member.id, label: "agent", prefix: keyPrefix, sha256: keyHash },
  });
  const model = await db.model.create({
    data: { name: opts.logicalModel ?? `fast-flash-${crypto.randomUUID().slice(0, 8)}` },
  });
  await db.apiKeyModel.create({ data: { keyId: key.id, modelId: model.id } });
  const provider = await db.provider.create({
    data: { name: `CommandCode ${crypto.randomUUID()}`, kind: opts.wire ?? "openai", baseUrl: mock.url },
  });
  const mappings = [];
  for (const upstreamModel of opts.upstreamModels) {
    const account = await db.account.create({
      data: { providerId: provider.id, label: `compte-${crypto.randomUUID().slice(0, 8)}` },
    });
    await db.accountCredential.create({
      data: {
        accountId: account.id,
        enc: encryptSecret(UPSTREAM_CRED, TEST_MASTER_KEY),
        keyPrefix: "upstream-",
        last4: "0000",
      },
    });
    const mapping = await db.modelAccount.create({
      data: { modelId: model.id, accountId: account.id, upstreamModel },
    });
    mappings.push({ mapping, account });
  }
  return { token, member, key, model, provider, mappings };
}

function chat(
  token: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return testApp().request("/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
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

/** All capture rows, once the fire-and-forget write has landed. */
function rows() {
  return db.request.findMany();
}

describe("capture pipeline — Task 12 matrix", () => {
  it("stream request → exactly one ok row with usage, timings, and 0.275 cost", async () => {
    const { token, member, key, model, provider, mappings } = await seedProxyStack({
      upstreamModels: ["big-usage-model"],
    });
    await db.price.create({
      data: {
        accountId: mappings[0]!.account.id,
        modelMatcher: "big-usage-model",
        priceInput: 0.1,
        priceOutput: 0.2,
        priceCachedInput: 0.05,
      },
    });
    clearPriceCache();

    const res = await chat(token, {
      model: model.name,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(200);
    await res.text();

    const all = await waitFor(async () => {
      const r = await rows();
      return r.length === 1 ? r : null;
    });
    const row = all[0]!;
    expect(row.status).toBe("ok");
    expect(row.httpStatus).toBe(200);
    expect(row.stream).toBe(true);
    expect(row.wireFormat).toBe("openai");
    expect(row.keyId).toBe(key.id);
    expect(row.memberId).toBe(member.id);
    expect(row.accountId).toBe(mappings[0]!.account.id);
    expect(row.modelId).toBe(model.id);
    expect(row.requestedModel).toBe(model.name);
    expect(row.upstreamModel).toBe("big-usage-model");
    expect(row.promptTokens).toBe(1_000_000);
    expect(row.completionTokens).toBe(1_000_000);
    expect(row.cachedTokens).toBe(500_000);
    expect(row.toolCallCount).toBe(1);
    expect(row.finishReason).toBe("tool_calls");
    expect(row.ttftMs).not.toBeNull();
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    // Task 7 fixture: 500k cached @0.05 + 500k @0.10 + 1M out @0.20 = 0.275
    expect(row.costUsd).toBeCloseTo(0.275, 6);
    expect(provider.kind).toBe("openai");
  });

  it("429 failover → single row records the serving account B", async () => {
    const { token, model, mappings } = await seedProxyStack({
      upstreamModels: ["rate-limited-a", "deepseek/deepseek-v4.1-flash"],
    });

    const res = await chat(token, { model: model.name, stream: true, messages: [] });
    expect(res.status).toBe(200);
    await res.text();

    const all = await waitFor(async () => ((await rows()).length === 1 ? rows() : null));
    expect(all[0]!.status).toBe("ok");
    expect(all[0]!.accountId).toBe(mappings[1]!.account.id);
  });

  it("upstream 400 → error row, no retry, exactly one row", async () => {
    const { token, model, mappings } = await seedProxyStack({
      upstreamModels: ["client-error-model"],
    });

    const res = await chat(token, { model: model.name, stream: false, messages: [] });
    expect(res.status).toBe(400);

    const all = await waitFor(async () => ((await rows()).length === 1 ? rows() : null));
    expect(all[0]!.status).toBe("error");
    expect(all[0]!.httpStatus).toBe(400);
    expect(all[0]!.accountId).toBe(mappings[0]!.account.id);
    expect(mock.requests.filter((r) => r.model === "client-error-model")).toHaveLength(1);
  });

  it("client abort mid-stream → aborted row written, upstream sees disconnect, no hanging streams", async () => {
    const { token, model } = await seedProxyStack({ upstreamModels: ["slow-model"] });

    const res = await chat(token, { model: model.name, stream: true, messages: [] });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    const all = await waitFor(
      async () => ((await rows()).length === 1 ? rows() : null),
      10_000,
    );
    const row = all[0]!;
    expect(row.status).toBe("aborted");
    expect(row.httpStatus).toBe(200);

    await waitFor(async () => (mock.disconnects >= 1 ? true : null), 10_000);
    expect(mock.pendingStreams).toBe(0);
  });

  it("unknown key → one 401 row with all ids null", async () => {
    const res = await chat("pt_00000000000000000000000000000000deadbeef", {
      model: "some-model-x",
      messages: [],
    });
    expect(res.status).toBe(401);

    const all = await waitFor(async () => ((await rows()).length === 1 ? rows() : null));
    const row = all[0]!;
    expect(row.status).toBe("error");
    expect(row.httpStatus).toBe(401);
    expect(row.errorCode).toBe("invalid_api_key");
    expect(row.keyId).toBeNull();
    expect(row.memberId).toBeNull();
    expect(row.accountId).toBeNull();
    expect(row.modelId).toBeNull();
    expect(row.costUsd).toBeNull();
  });

  it("wrong wire format → one 400 row with null account/model ids", async () => {
    const { token, model } = await seedProxyStack({
      upstreamModels: ["claude-sonnet-4"],
      wire: "anthropic",
    });

    const res = await chat(token, { model: model.name, stream: false, messages: [] });
    expect(res.status).toBe(400);

    const all = await waitFor(async () => ((await rows()).length === 1 ? rows() : null));
    const row = all[0]!;
    expect(row.status).toBe("error");
    expect(row.httpStatus).toBe(400);
    expect(row.errorCode).toBe("wrong_wire_format");
    expect(row.accountId).toBeNull();
    expect(row.modelId).toBeNull();
    expect(row.requestedModel).toBe(model.name);
  });

  it("anthropic stream → same columns: usage mapped, thinking in reasoningTokens, tool_use counted", async () => {
    const { token, model } = await seedProxyStack({
      upstreamModels: ["claude-sonnet-4"],
      wire: "anthropic",
    });

    const res = await testApp().request("/v1/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.name, stream: true, max_tokens: 64, messages: [] }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const all = await waitFor(async () => ((await rows()).length === 1 ? rows() : null));
    const row = all[0]!;
    expect(row.status).toBe("ok");
    expect(row.wireFormat).toBe("anthropic");
    expect(row.promptTokens).toBe(100);
    expect(row.completionTokens).toBe(42);
    expect(row.reasoningTokens).toBe(12);
    expect(row.toolCallCount).toBe(1);
    expect(row.finishReason).toBe("tool_use");
    expect(row.upstreamModel).toBe("claude-sonnet-4");
  });

  it("non-stream response captures usage from the JSON body, ttftMs null", async () => {
    const { token, model } = await seedProxyStack({
      upstreamModels: ["deepseek/deepseek-v4.1-flash"],
    });

    const res = await chat(token, { model: model.name, stream: false, messages: [] });
    expect(res.status).toBe(200);
    await res.text();

    const all = await waitFor(async () => ((await rows()).length === 1 ? rows() : null));
    const row = all[0]!;
    expect(row.status).toBe("ok");
    expect(row.stream).toBe(false);
    expect(row.promptTokens).toBe(1024);
    expect(row.completionTokens).toBe(64);
    expect(row.cachedTokens).toBe(512);
    expect(row.ttftMs).toBeNull();
  });
});
