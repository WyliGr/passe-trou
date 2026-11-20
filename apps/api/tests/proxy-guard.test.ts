import { describe, expect, it } from "vitest";
import { ApiError } from "../src/app.ts";
import { generateApiKey } from "../src/lib/crypto.ts";
import { resolveRequest, type AuthedKey } from "../src/proxy/resolve.ts";
import { db, testApp } from "./setup.ts";

async function seedKey(opts: { keyEnabled?: boolean; memberEnabled?: boolean } = {}) {
  const member = await db.member.create({
    data: { name: `Will ${crypto.randomUUID()}`, enabled: opts.memberEnabled ?? true },
  });
  const { token, keyPrefix, keyHash } = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      memberId: member.id,
      label: "agent",
      prefix: keyPrefix,
      sha256: keyHash,
      enabled: opts.keyEnabled ?? true,
    },
  });
  return { token, key };
}

async function loadAuthedKey(keyId: string): Promise<AuthedKey> {
  return db.apiKey.findUniqueOrThrow({
    where: { id: keyId },
    include: { member: true, allowedModels: true },
  });
}

async function seedStack() {
  const openaiProvider = await db.provider.create({
    data: { name: `CommandCode ${crypto.randomUUID()}`, kind: "openai" },
  });
  const openaiAccount = await db.account.create({
    data: { providerId: openaiProvider.id, label: "compte-1" },
  });
  const anthropicProvider = await db.provider.create({
    data: { name: `ClaudePool ${crypto.randomUUID()}`, kind: "anthropic" },
  });
  const anthropicAccount = await db.account.create({
    data: { providerId: anthropicProvider.id, label: "claude-1" },
  });
  return { openaiAccount, anthropicAccount };
}

async function catchApiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected resolveRequest to throw ApiError");
}

describe("proxyAuth middleware on /v1/*", () => {
  it("401 invalid_api_key without Authorization header", async () => {
    const app = testApp();
    const res = await app.request("/v1/chat/completions", { method: "POST" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_api_key");
  });

  it("401 for unknown, disabled, and non-pt_ tokens", async () => {
    const { token, key } = await seedKey({ keyEnabled: false });
    const app = testApp();
    for (const bad of [`Bearer ${token}`, "Bearer pt_00000000000000000000000000000000", "Bearer sk-not-ours"]) {
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { authorization: bad },
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("invalid_api_key");
    }
    expect(key.enabled).toBe(false);
  });

  it("401 when the key's member is disabled", async () => {
    const { token } = await seedKey({ memberEnabled: false });
    const app = testApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_api_key");
  });

  it("valid key passes auth (reaches the route: 400 on empty body, never 401)", async () => {
    const { token } = await seedKey();
    const app = testApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});

describe("resolveRequest", () => {
  it("404 model_not_found with availableModels filtered to allowlisted + enabled", async () => {
    const { key } = await seedKey();
    const { openaiAccount } = await seedStack();
    const allowed = await db.model.create({ data: { name: "fast-flash" } });
    await db.model.create({ data: { name: "brain-pro" } }); // enabled but not allowlisted
    await db.model.create({ data: { name: "hidden-off", enabled: false } }); // allowlisted but disabled
    await db.apiKeyModel.create({
      data: { keyId: key.id, modelId: allowed.id },
    });
    const hiddenOff = await db.model.findUniqueOrThrow({ where: { name: "hidden-off" } });
    await db.apiKeyModel.create({ data: { keyId: key.id, modelId: hiddenOff.id } });
    await db.modelAccount.create({
      data: { modelId: allowed.id, accountId: openaiAccount.id, upstreamModel: "deepseek/deepseek-v4.1-flash" },
    });

    const err = await catchApiError(
      resolveRequest(db, "nope", "openai", await loadAuthedKey(key.id)),
    );
    expect(err.status).toBe(404);
    expect(err.code).toBe("model_not_found");
    expect(err.extra?.availableModels).toEqual(["fast-flash"]);
  });

  it("empty allowlist is a wildcard: all enabled models listed and allowed", async () => {
    const { key } = await seedKey();
    const { openaiAccount } = await seedStack();
    const model = await db.model.create({ data: { name: "fast-flash" } });
    await db.model.create({ data: { name: "brain-pro" } });
    await db.modelAccount.create({
      data: { modelId: model.id, accountId: openaiAccount.id, upstreamModel: "deepseek/deepseek-v4.1-flash" },
    });

    const resolved = await resolveRequest(db, "fast-flash", "openai", await loadAuthedKey(key.id));
    expect(resolved.model.id).toBe(model.id);
    expect(resolved.mappings).toHaveLength(1);

    const err = await catchApiError(resolveRequest(db, "nope", "openai", await loadAuthedKey(key.id)));
    expect(err.extra?.availableModels).toEqual(["fast-flash", "brain-pro"]);
  });

  it("403 model_not_allowed when model is outside a non-empty allowlist", async () => {
    const { key } = await seedKey();
    const allowed = await db.model.create({ data: { name: "fast-flash" } });
    const other = await db.model.create({ data: { name: "brain-pro" } });
    await db.apiKeyModel.create({ data: { keyId: key.id, modelId: allowed.id } });

    const err = await catchApiError(
      resolveRequest(db, other.name, "openai", await loadAuthedKey(key.id)),
    );
    expect(err.status).toBe(403);
    expect(err.code).toBe("model_not_allowed");
  });

  it("503 no_healthy_accounts when no mapping is enabled on an enabled account", async () => {
    const { key } = await seedKey();
    const { openaiAccount } = await seedStack();
    const model = await db.model.create({ data: { name: "fast-flash" } });
    await db.modelAccount.create({
      data: { modelId: model.id, accountId: openaiAccount.id, enabled: false },
    });
    await db.account.update({ where: { id: openaiAccount.id }, data: { enabled: false } });

    const err = await catchApiError(
      resolveRequest(db, "fast-flash", "openai", await loadAuthedKey(key.id)),
    );
    expect(err.status).toBe(503);
    expect(err.code).toBe("no_healthy_accounts");
  });

  it("400 wrong_wire_format with hint naming /v1/messages when only anthropic mappings exist", async () => {
    const { key } = await seedKey();
    const { anthropicAccount } = await seedStack();
    const model = await db.model.create({ data: { name: "claude-fast" } });
    await db.modelAccount.create({
      data: { modelId: model.id, accountId: anthropicAccount.id, upstreamModel: "claude-sonnet-4" },
    });

    const err = await catchApiError(
      resolveRequest(db, "claude-fast", "openai", await loadAuthedKey(key.id)),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe("wrong_wire_format");
    expect(String(err.extra?.hint)).toContain("/v1/messages");
  });

  it("400 wrong_wire_format with hint naming /v1/chat/completions when only openai mappings exist", async () => {
    const { key } = await seedKey();
    const { openaiAccount } = await seedStack();
    const model = await db.model.create({ data: { name: "fast-flash" } });
    await db.modelAccount.create({
      data: { modelId: model.id, accountId: openaiAccount.id, upstreamModel: "deepseek/deepseek-v4.1-flash" },
    });

    const err = await catchApiError(
      resolveRequest(db, "fast-flash", "anthropic", await loadAuthedKey(key.id)),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe("wrong_wire_format");
    expect(String(err.extra?.hint)).toContain("/v1/chat/completions");
  });

  it("happy path: drops wire-mismatched mappings, keeps enabled matching ones", async () => {
    const { key } = await seedKey();
    const { openaiAccount, anthropicAccount } = await seedStack();
    const model = await db.model.create({ data: { name: "dual" } });
    const off = await db.account.create({
      data: { providerId: (await db.provider.findFirstOrThrow({ where: { kind: "openai" } })).id, label: "benched", enabled: false },
    });
    await db.modelAccount.create({
      data: { modelId: model.id, accountId: openaiAccount.id, upstreamModel: "deepseek/x" },
    });
    await db.modelAccount.create({
      data: { modelId: model.id, accountId: anthropicAccount.id, upstreamModel: "claude-y" },
    });
    await db.modelAccount.create({ data: { modelId: model.id, accountId: off.id, upstreamModel: "deepseek/z" } });

    const resolved = await resolveRequest(db, "dual", "openai", await loadAuthedKey(key.id));
    expect(resolved.mappings.map((m) => m.upstreamModel)).toEqual(["deepseek/x"]);
    expect(resolved.mappings[0]!.account.provider.kind).toBe("openai");
  });
});
