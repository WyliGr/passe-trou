import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, generateApiKey } from "../src/lib/crypto.ts";
import { clearPriceCache } from "../src/proxy/capture.ts";
import { startMockUpstream, type MockUpstream } from "./fixtures/mockUpstream.ts";
import { EMBEDDINGS_JSON_BODY } from "./fixtures/streams.ts";
import { db, testApp, TEST_MASTER_KEY } from "./setup.ts";

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

async function newMember() {
  const member = await db.member.create({ data: { name: `Will ${crypto.randomUUID()}` } });
  const { token, keyPrefix, keyHash } = generateApiKey();
  const key = await db.apiKey.create({
    data: { memberId: member.id, label: "agent", prefix: keyPrefix, sha256: keyHash },
  });
  return { member, key, token };
}

async function newModel(name: string, enabled = true) {
  return db.model.create({ data: { name, enabled } });
}

/** Model + openai-kind provider/account/mapping chain against the mock. */
async function mappedAccount(
  modelId: string,
  upstreamModel: string,
  kind: "openai" | "anthropic" = "openai",
) {
  const provider = await db.provider.create({
    data: { name: `P ${crypto.randomUUID()}`, kind, baseUrl: mock.url },
  });
  const account = await db.account.create({
    data: { providerId: provider.id, label: `compte-${crypto.randomUUID().slice(0, 8)}` },
  });
  await db.accountCredential.create({
    data: {
      accountId: account.id,
      enc: encryptSecret("upstream-test-credential-0000", TEST_MASTER_KEY),
      keyPrefix: "upstream-",
      last4: "0000",
    },
  });
  const mapping = await db.modelAccount.create({
    data: { modelId, accountId: account.id, upstreamModel },
  });
  return { provider, account, mapping };
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

function getModels(token: string) {
  return testApp().request("/v1/models", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function postEmbeddings(token: string, body: Record<string, unknown>) {
  return testApp().request("/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /v1/models", () => {
  it("lists only the key's allowlisted, enabled models", async () => {
    const flash = await newModel("fast-flash");
    await newModel("brain-pro");
    const { token, key } = await newMember();
    await db.apiKeyModel.create({ data: { keyId: key.id, modelId: flash.id } });

    const res = await getModels(token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(["fast-flash"]);
    expect(body.data[0].object).toBe("model");
    expect(typeof body.data[0].created).toBe("number");
    expect(body.data[0].owned_by).toBe("passe•trou");
  });

  it("empty allowlist = wildcard: all enabled models, disabled hidden", async () => {
    await newModel("fast-flash");
    await newModel("brain-pro");
    await newModel("retired-model", false);
    const { token } = await newMember();

    const res = await getModels(token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(["fast-flash", "brain-pro"]);
  });
});

describe("POST /v1/embeddings", () => {
  it("passes through with model rewrite and captures a prompt-only cost row", async () => {
    mock.requests.length = 0;
    const model = await newModel("fast-flash");
    const { account } = await mappedAccount(model.id, "embed-v1");
    const { token, key } = await newMember();
    await db.apiKeyModel.create({ data: { keyId: key.id, modelId: model.id } });
    await db.price.create({
      data: {
        accountId: account.id,
        modelMatcher: "embed-v1",
        priceInput: 0.1,
        priceOutput: 0.2,
      },
    });
    clearPriceCache();

    const res = await postEmbeddings(token, { model: model.name, input: "Bonjour" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMBEDDINGS_JSON_BODY);

    // Upstream saw the mapped name on the embeddings path.
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.path).toBe("/embeddings");
    expect(mock.requests[0]!.body.model).toBe("embed-v1");

    const rows = await waitFor(async () => {
      const r = await db.request.findMany();
      return r.length === 1 ? r : null;
    });
    const row = rows[0]!;
    expect(row.status).toBe("ok");
    expect(row.stream).toBe(false);
    expect(row.promptTokens).toBe(1024);
    expect(row.completionTokens).toBeNull();
    // Prompt tokens only: 1024/1M @ 0.10 input.
    expect(row.costUsd).toBeCloseTo(0.0001024, 10);
    expect(row.upstreamModel).toBe("embed-v1");
  });

  it("model with only an anthropic-kind mapping → 400 wrong_wire_format, no upstream call", async () => {
    mock.requests.length = 0;
    const model = await newModel("claude-emb");
    await mappedAccount(model.id, "claude-sonnet-4", "anthropic");
    const { token, key } = await newMember();
    await db.apiKeyModel.create({ data: { keyId: key.id, modelId: model.id } });

    const res = await postEmbeddings(token, { model: model.name, input: "hi" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("wrong_wire_format");
    expect(mock.requests).toHaveLength(0);
  });

  it("model outside the key allowlist → 403 model_not_allowed", async () => {
    const model = await newModel("fast-flash");
    await mappedAccount(model.id, "embed-v1");
    const other = await newModel("brain-pro");
    const { token, key } = await newMember();
    await db.apiKeyModel.create({ data: { keyId: key.id, modelId: other.id } });

    const res = await postEmbeddings(token, { model: model.name, input: "hi" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("model_not_allowed");
  });
});
