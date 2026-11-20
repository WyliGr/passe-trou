import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, generateApiKey } from "../src/lib/crypto.ts";
import { balancer } from "../src/proxy/balancer.ts";
import { startMockUpstream, type MockUpstream } from "./fixtures/mockUpstream.ts";
import { ANTHROPIC_JSON_BODY, ANTHROPIC_STREAM } from "./fixtures/streams.ts";
import { db, testApp, TEST_MASTER_KEY } from "./setup.ts";

let mock: MockUpstream;

beforeAll(async () => {
  mock = await startMockUpstream();
});
afterAll(async () => {
  await mock.close();
});

const UPSTREAM_TEST_CREDENTIAL = "upstream-test-credential-0000";

async function seedAnthropicStack(opts: {
  upstreamModels: string[];
  logicalModel?: string;
  wire?: "openai" | "anthropic";
}) {
  const member = await db.member.create({ data: { name: `Will ${crypto.randomUUID()}` } });
  const { token, keyPrefix, keyHash } = generateApiKey();
  const key = await db.apiKey.create({
    data: { memberId: member.id, label: "agent", prefix: keyPrefix, sha256: keyHash },
  });
  const model = await db.model.create({
    data: { name: opts.logicalModel ?? `claude-fast-${crypto.randomUUID().slice(0, 8)}` },
  });
  await db.apiKeyModel.create({ data: { keyId: key.id, modelId: model.id } });
  const provider = await db.provider.create({
    data: {
      name: `ClaudePool ${crypto.randomUUID()}`,
      kind: opts.wire ?? "anthropic",
      baseUrl: mock.url,
    },
  });
  const mappings = [];
  for (const upstreamModel of opts.upstreamModels) {
    const account = await db.account.create({
      data: { providerId: provider.id, label: `claude-${crypto.randomUUID().slice(0, 8)}` },
    });
    await db.accountCredential.create({
      data: {
        accountId: account.id,
        enc: encryptSecret(UPSTREAM_TEST_CREDENTIAL, TEST_MASTER_KEY),
        keyPrefix: "upstream-",
        last4: "0000",
      },
    });
    const mapping = await db.modelAccount.create({
      data: { modelId: model.id, accountId: account.id, upstreamModel },
    });
    mappings.push({ mapping, account });
  }
  return { token, model, mappings };
}

function messagesRequest(
  token: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return testApp().request("/v1/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/messages", () => {
  it("streams bytes verbatim, rewrites model, forwards anthropic-version + anthropic-beta", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedAnthropicStack({
      upstreamModels: ["claude-sonnet-4-20250514"],
    });

    const res = await messagesRequest(
      token,
      { model: model.name, stream: true, max_tokens: 256, messages: [{ role: "user", content: "hi" }] },
      { "anthropic-version": "2023-06-01", "anthropic-beta": "interleaved-thinking-2025-05-14" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Passthrough purity: exact bytes the mock sent reach the client, incl. usage events.
    expect(await res.text()).toBe(ANTHROPIC_STREAM);

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.path).toBe("/messages");
    expect(mock.requests[0]!.body.model).toBe("claude-sonnet-4-20250514");
    expect(mock.requests[0]!.body.model).not.toBe(model.name);
    expect(mock.requests[0]!.body.max_tokens).toBe(256);
    expect(mock.requests[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(mock.requests[0]!.headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14");
    expect(mock.requests[0]!.headers.authorization).toBe(`Bearer ${UPSTREAM_TEST_CREDENTIAL}`);
    expect(mock.requests[0]!.headers["user-agent"]).toBe(
      "passe-trou/0.1 (-https://github.com/WyliGr/passe-trou)",
    );
  });

  it("non-stream body proxies verbatim (usage stays in the body)", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedAnthropicStack({
      upstreamModels: ["claude-sonnet-4-20250514"],
    });
    const res = await messagesRequest(token, {
      model: model.name,
      max_tokens: 64,
      messages: [],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ANTHROPIC_JSON_BODY);
  });

  it("429 fails over to a second anthropic account, trips first one", async () => {
    const { token, model, mappings } = await seedAnthropicStack({
      upstreamModels: ["rate-limited-claude", "claude-sonnet-4-20250514"],
    });
    const res = await messagesRequest(token, {
      model: model.name,
      stream: true,
      max_tokens: 64,
      messages: [],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ANTHROPIC_STREAM);
    expect(mock.requests.slice(-2).map((r) => r.model)).toEqual([
      "rate-limited-claude",
      "claude-sonnet-4-20250514",
    ]);
    const cd = balancer.cooldownRemainingSec(mappings[0]!.mapping.id);
    expect(cd).not.toBeNull();
  });

  it("openai-kind-only model → 400 wrong_wire_format before any upstream call", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedAnthropicStack({
      upstreamModels: ["deepseek/deepseek-v4.1-flash"],
      wire: "openai",
    });
    const res = await messagesRequest(token, { model: model.name, max_tokens: 64, messages: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("wrong_wire_format");
    expect(body.error.hint).toContain("/v1/chat/completions");
    expect(mock.requests.length).toBe(0);
  });
});
