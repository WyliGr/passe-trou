import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, generateApiKey } from "../src/lib/crypto.ts";
import { balancer } from "../src/proxy/balancer.ts";
import { startMockUpstream, type MockUpstream } from "./fixtures/mockUpstream.ts";
import {
  OPENAI_JSON_BODY,
  OPENAI_STREAM_NO_USAGE,
  OPENAI_STREAM_WITH_USAGE,
} from "./fixtures/streams.ts";
import { db, testApp, TEST_MASTER_KEY } from "./setup.ts";

let mock: MockUpstream;

beforeAll(async () => {
  mock = await startMockUpstream();
});
afterAll(async () => {
  await mock.close();
});

/** Clearly fake upstream credential — never a real provider key. */
export const UPSTREAM_TEST_CREDENTIAL = "upstream-test-credential-0000";

interface SeedOpts {
  upstreamModels: string[]; // one account+mapping per entry, in creation order
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
    data: {
      name: `CommandCode ${crypto.randomUUID()}`,
      kind: opts.wire ?? "openai",
      baseUrl: mock.url,
    },
  });
  const mappings = [];
  for (const upstreamModel of opts.upstreamModels) {
    const account = await db.account.create({
      data: { providerId: provider.id, label: `compte-${crypto.randomUUID().slice(0, 8)}` },
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

function chatRequest(token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return testApp().request("/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/chat/completions", () => {
  it("streams bytes verbatim end-to-end, rewrites model upstream, forces include_usage", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedProxyStack({
      upstreamModels: ["deepseek/deepseek-v4.1-flash"],
    });
    const upstreamModel = "deepseek/deepseek-v4.1-flash";

    const res = await chatRequest(token, {
      model: model.name,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Passthrough purity: exact bytes the mock sent reach the client.
    expect(await res.text()).toBe(OPENAI_STREAM_WITH_USAGE);

    // Model rewrite: upstream sees the mapped name, never the logical one.
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.body.model).toBe(upstreamModel);
    expect(mock.requests[0]!.body.model).not.toBe(model.name);
    // Forced usage accounting upstream; rest of the body passed through.
    expect(mock.requests[0]!.body.stream_options).toEqual({ include_usage: true });
    expect(mock.requests[0]!.body.messages).toEqual([{ role: "user", content: "hi" }]);
    // Credential flows via the vault; upstream got the account's key.
    expect(mock.requests[0]!.headers.authorization).toBe(`Bearer ${UPSTREAM_TEST_CREDENTIAL}`);
    // No client UA → passe-trou UA (Cloudflare filters default library UAs).
    expect(mock.requests[0]!.headers["user-agent"]).toBe(
      "passe-trou/0.1 (-https://github.com/WyliGr/passe-trou)",
    );
  });

  it("suppresses the forced usage chunk when the client never set stream_options", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedProxyStack({
      upstreamModels: ["deepseek/deepseek-v4.1-flash"],
    });

    const res = await chatRequest(token, { model: model.name, stream: true, messages: [] });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(OPENAI_STREAM_NO_USAGE);
    expect(text).not.toContain('"prompt_tokens"');
    // …but the proxy did force usage accounting upstream.
    expect(mock.requests[0]!.body.stream_options).toEqual({ include_usage: true });
  });

  it("forwards the client's user-agent when present", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedProxyStack({
      upstreamModels: ["deepseek/deepseek-v4.1-flash"],
    });
    const res = await chatRequest(
      token,
      { model: model.name, stream: false, messages: [] },
      { "user-agent": "will-agent/9.1" },
    );
    expect(res.status).toBe(200);
    expect(mock.requests[0]!.headers["user-agent"]).toBe("will-agent/9.1");
  });

  it("non-stream response passes through verbatim, no stream_options injected", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedProxyStack({
      upstreamModels: ["deepseek/deepseek-v4.1-flash"],
    });
    const res = await chatRequest(token, { model: model.name, stream: false, messages: [] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(OPENAI_JSON_BODY);
    expect(mock.requests[0]!.body.stream_options).toBeUndefined();
  });

  it("stream without upstream usage chunk still succeeds (usage simply absent)", async () => {
    const { token, model } = await seedProxyStack({
      upstreamModels: ["deepseek/no-usage-v1"],
    });
    const res = await chatRequest(token, {
      model: model.name,
      stream: true,
      stream_options: { include_usage: true },
      messages: [],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(OPENAI_STREAM_NO_USAGE);
  });

  it("429 on first account silently fails over to the second (client sees 200) and trips it 45 s", async () => {
    const { token, model, mappings } = await seedProxyStack({
      upstreamModels: ["rate-limited-a", "deepseek/deepseek-v4.1-flash"],
    });

    const res = await chatRequest(token, {
      model: model.name,
      stream: true,
      stream_options: { include_usage: true },
      messages: [],
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(OPENAI_STREAM_WITH_USAGE);
    expect(mock.requests.slice(-2).map((r) => r.model)).toEqual([
      "rate-limited-a",
      "deepseek/deepseek-v4.1-flash",
    ]);
    const cooldownSec = balancer.cooldownRemainingSec(mappings[0]!.mapping.id);
    expect(cooldownSec).not.toBeNull();
    expect(cooldownSec!).toBeGreaterThan(40);
    expect(cooldownSec!).toBeLessThanOrEqual(45);
    expect(balancer.cooldownRemainingSec(mappings[1]!.mapping.id)).toBeNull();
  });

  it("all accounts 429 → forwarded verbatim: status, retry-after, body", async () => {
    const { token, model } = await seedProxyStack({
      upstreamModels: ["rate-limited-a", "rate-limited-b"],
    });

    const res = await chatRequest(token, { model: model.name, stream: false, messages: [] });

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("45");
    expect(await res.text()).toBe(
      JSON.stringify({ error: { message: "rate limited upstream", type: "rate_limit_error" } }),
    );

    // Next request: whole pool cooling → immediate 503, no upstream call.
    const count = mock.requests.length;
    const res2 = await chatRequest(token, { model: model.name, stream: false, messages: [] });
    expect(res2.status).toBe(503);
    const body = await res2.json();
    expect(body.error.code).toBe("pool_exhausted");
    expect(body.error.retryAfterSec).toBeGreaterThan(40);
    expect(mock.requests.length).toBe(count);
  });

  it("upstream 500 fails over; upstream 4xx forwards immediately without retry", async () => {
    const { token, model } = await seedProxyStack({
      upstreamModels: ["broken", "deepseek/deepseek-v4.1-flash"],
    });
    const res = await chatRequest(token, { model: model.name, stream: false, messages: [] });
    expect(res.status).toBe(200);
    expect(mock.requests.slice(-2).map((r) => r.model)).toEqual([
      "broken",
      "deepseek/deepseek-v4.1-flash",
    ]);
  });

  it("wrong-wire model → 400 wrong_wire_format before any upstream call", async () => {
    mock.requests.length = 0;
    const { token, model } = await seedProxyStack({
      upstreamModels: ["claude-sonnet-4"],
      wire: "anthropic",
    });
    const res = await chatRequest(token, { model: model.name, stream: false, messages: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("wrong_wire_format");
    expect(body.error.hint).toContain("/v1/messages");
    expect(mock.requests.length).toBe(0);
  });
});
