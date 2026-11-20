import { describe, expect, it } from "vitest";
import { adminHeaders, db, testApp } from "./setup.ts";

const URL = "http://localhost";

function req(path: string, init: RequestInit = {}) {
  return testApp().request(`${URL}${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init.headers ?? {}) },
  });
}

function jsonReq(method: string, path: string, body: unknown) {
  return req(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createProvider(displayName = "CommandCode") {
  const res = await jsonReq("POST", "/admin/providers", {
    displayName,
    type: "openai-compatible",
    baseUrl: "https://api.commandcode.ai/provider/v1",
  });
  return (await res.json()) as { id: string };
}

async function createAccount(providerId: string, displayName = "compte-1") {
  const res = await jsonReq("POST", `/admin/providers/${providerId}/accounts`, { displayName });
  return (await res.json()) as { id: string };
}

async function createModel(displayName = "fast-flash") {
  return jsonReq("POST", "/admin/models", { displayName });
}

describe("POST /admin/models", () => {
  it("creates a model (201), enabled by default, no mappings", async () => {
    const res = await createModel();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      displayName: "fast-flash",
      enabled: true,
      mappings: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("creates a disabled model when enabled=false", async () => {
    const res = await jsonReq("POST", "/admin/models", {
      displayName: "brain-pro",
      enabled: false,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).enabled).toBe(false);
  });

  it("409 duplicate_name on conflicting displayName", async () => {
    await createModel();
    const res = await createModel();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("duplicate_name");
  });

  it("400 on invalid body", async () => {
    for (const bad of [{}, { displayName: "" }, { displayName: 42 }]) {
      const res = await jsonReq("POST", "/admin/models", bad);
      expect(res.status).toBe(400);
    }
  });

  it("401 without admin token", async () => {
    const res = await testApp().request(`${URL}/admin/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/models", () => {
  it("lists models with inlined mappings", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    await jsonReq("POST", `/admin/models/${model.id}/mappings`, {
      accountId: account.id,
      upstreamModel: "deepseek/deepseek-v4.1-flash",
    });
    await createModel("brain-pro");

    const res = await req("/admin/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    const flash = body.find((m: { displayName: string }) => m.displayName === "fast-flash");
    expect(flash.mappings).toHaveLength(1);
    expect(flash.mappings[0]).toMatchObject({
      accountId: account.id,
      accountName: "compte-1",
      providerName: "CommandCode",
      providerType: "openai-compatible",
      accountEnabled: true,
      upstreamModel: "deepseek/deepseek-v4.1-flash",
    });
  });
});

describe("GET/PATCH/DELETE /admin/models/:id", () => {
  it("GET returns the model; 404 unknown", async () => {
    const model = await (await createModel()).json();
    const res = await req(`/admin/models/${model.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("fast-flash");
    expect((await req("/admin/models/nope")).status).toBe(404);
  });

  it("PATCH renames and disables a model", async () => {
    const model = await (await createModel()).json();
    const res = await jsonReq("PATCH", `/admin/models/${model.id}`, {
      displayName: "flash-fast",
      enabled: false,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("flash-fast");
    expect(body.enabled).toBe(false);
    expect(
      (await jsonReq("PATCH", "/admin/models/nope", { enabled: false })).status,
    ).toBe(404);
  });

  it("PATCH 409 duplicate_name on conflicting displayName", async () => {
    await createModel();
    const second = await (await createModel("brain-pro")).json();
    const res = await jsonReq("PATCH", `/admin/models/${second.id}`, {
      displayName: "fast-flash",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("duplicate_name");
  });

  it("DELETE removes a model without mappings (204); 404 afterwards", async () => {
    const model = await (await createModel()).json();
    const res = await req(`/admin/models/${model.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await req(`/admin/models/${model.id}`)).status).toBe(404);
    expect((await req("/admin/models/nope", { method: "DELETE" })).status).toBe(404);
  });

  it("DELETE 409 model_has_mappings while mappings exist; deletable after mapping removed", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    const mapping = await (
      await jsonReq("POST", `/admin/models/${model.id}/mappings`, { accountId: account.id })
    ).json();

    const blocked = await req(`/admin/models/${model.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("model_has_mappings");

    await req(`/admin/mappings/${mapping.id}`, { method: "DELETE" });
    const res = await req(`/admin/models/${model.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});

describe("POST /admin/models/:id/mappings", () => {
  it("creates a mapping (201); upstreamModel defaults to null", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    const res = await jsonReq("POST", `/admin/models/${model.id}/mappings`, {
      accountId: account.id,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      accountId: account.id,
      accountName: "compte-1",
      providerName: "CommandCode",
      providerType: "openai-compatible",
      accountEnabled: true,
      upstreamModel: null,
    });
  });

  it("stores and returns the upstreamModel override", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    const res = await jsonReq("POST", `/admin/models/${model.id}/mappings`, {
      accountId: account.id,
      upstreamModel: "tngtech/deepseek-r1t2-chimera:free",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upstreamModel).toBe("tngtech/deepseek-r1t2-chimera:free");
    const show = await (await req(`/admin/models/${model.id}`)).json();
    expect(show.mappings[0].upstreamModel).toBe("tngtech/deepseek-r1t2-chimera:free");
  });

  it("404 on unknown model or unknown account", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    expect(
      (await jsonReq("POST", "/admin/models/nope/mappings", { accountId: account.id })).status,
    ).toBe(404);
    expect(
      (await jsonReq("POST", `/admin/models/${model.id}/mappings`, { accountId: "nope" })).status,
    ).toBe(404);
  });

  it("409 duplicate_mapping when the account is already mapped", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    await jsonReq("POST", `/admin/models/${model.id}/mappings`, { accountId: account.id });
    const res = await jsonReq("POST", `/admin/models/${model.id}/mappings`, {
      accountId: account.id,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("duplicate_mapping");
  });

  it("400 on invalid body", async () => {
    const model = await (await createModel()).json();
    for (const bad of [{}, { accountId: "" }, { upstreamModel: "x" }]) {
      const res = await jsonReq("POST", `/admin/models/${model.id}/mappings`, bad);
      expect(res.status).toBe(400);
    }
  });
});

describe("DELETE /admin/mappings/:mappingId", () => {
  it("removes the mapping (204); gone from model afterwards; 404 unknown", async () => {
    const provider = await createProvider();
    const account = await createAccount(provider.id);
    const model = await (await createModel()).json();
    const mapping = await (
      await jsonReq("POST", `/admin/models/${model.id}/mappings`, { accountId: account.id })
    ).json();

    const res = await req(`/admin/mappings/${mapping.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const show = await (await req(`/admin/models/${model.id}`)).json();
    expect(show.mappings).toHaveLength(0);
    expect(await db.modelAccount.count()).toBe(0);
    expect((await req(`/admin/mappings/${mapping.id}`, { method: "DELETE" })).status).toBe(404);
  });
});
