import { describe, expect, it } from "vitest";
import { adminHeaders, db, testApp } from "./setup.ts";

const URL = "http://localhost";

async function req(path: string, init: RequestInit = {}) {
  return testApp().request(`${URL}${path}`, {
    ...init,
    headers: { ...await adminHeaders(), ...(init.headers ?? {}) },
  });
}

function jsonReq(method: string, path: string, body: unknown) {
  return req(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  displayName: "CommandCode",
  type: "openai-compatible",
  baseUrl: "https://api.commandcode.ai/provider/v1",
};

async function createProvider(body: unknown = VALID_BODY) {
  const res = await jsonReq("POST", "/admin/providers", body);
  return res;
}

describe("POST /admin/providers", () => {
  it("creates a provider (201) with audit fields", async () => {
    const res = await createProvider();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      displayName: "CommandCode",
      type: "openai-compatible",
      baseUrl: "https://api.commandcode.ai/provider/v1",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("409 on duplicate displayName", async () => {
    await createProvider();
    const res = await createProvider({ ...VALID_BODY, baseUrl: "https://other.example.com/v1" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: expect.any(String) } });
  });

  it("400 on missing / invalid fields", async () => {
    for (const bad of [
      {},
      { ...VALID_BODY, displayName: "" },
      { ...VALID_BODY, type: "openai" },
      { ...VALID_BODY, type: "whatever" },
      { ...VALID_BODY, baseUrl: "not-a-url" },
      { ...VALID_BODY, baseUrl: "ftp://example.com" },
    ]) {
      const res = await createProvider(bad);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({ error: { code: expect.any(String) } });
    }
  });

  it("400 on non-JSON body", async () => {
    const res = await req("/admin/providers", { method: "POST", body: "not json{{" });
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/providers", () => {
  it("lists providers (empty then populated)", async () => {
    const empty = await req("/admin/providers");
    expect(await empty.json()).toEqual([]);
    await createProvider();
    await createProvider({
      displayName: "Mistral",
      type: "openai-compatible",
      baseUrl: "https://api.mistral.ai/v1",
    });
    const res = await req("/admin/providers");
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((p: { displayName: string }) => p.displayName)).toEqual([
      "CommandCode",
      "Mistral",
    ]);
  });
});

describe("GET/PATCH/DELETE /admin/providers/:id", () => {
  it("GET returns the provider, 404 on unknown id", async () => {
    const created = await (await createProvider()).json();
    const res = await req(`/admin/providers/${created.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("CommandCode");

    const missing = await req("/admin/providers/nope");
    expect(missing.status).toBe(404);
  });

  it("PATCH updates fields and bumps updatedAt", async () => {
    const created = await (await createProvider()).json();
    const res = await jsonReq("PATCH", `/admin/providers/${created.id}`, {
      displayName: "CC-renamed",
      type: "anthropic-compatible",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("CC-renamed");
    expect(body.type).toBe("anthropic-compatible");
    expect(body.baseUrl).toBe(VALID_BODY.baseUrl);
    expect(Date.parse(body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));

    const missing = await jsonReq("PATCH", "/admin/providers/nope", { displayName: "x" });
    expect(missing.status).toBe(404);
  });

  it("PATCH 409 on renaming into an existing displayName", async () => {
    await createProvider();
    const other = await (
      await createProvider({
        displayName: "Mistral",
        type: "openai-compatible",
        baseUrl: "https://api.mistral.ai/v1",
      })
    ).json();
    const res = await jsonReq("PATCH", `/admin/providers/${other.id}`, {
      displayName: "CommandCode",
    });
    expect(res.status).toBe(409);
  });

  it("PATCH 400 on invalid body", async () => {
    const created = await (await createProvider()).json();
    const res = await jsonReq("PATCH", `/admin/providers/${created.id}`, { type: "nope" });
    expect(res.status).toBe(400);
  });

  it("DELETE removes the provider; subsequent GET is 404", async () => {
    const created = await (await createProvider()).json();
    const res = await req(`/admin/providers/${created.id}`, { method: "DELETE" });
    expect([200, 204]).toContain(res.status);
    expect((await req(`/admin/providers/${created.id}`)).status).toBe(404);
    expect((await req(`/admin/providers/nope`, { method: "DELETE" })).status).toBe(404);
  });

  it("DELETE 409 provider_has_accounts when accounts exist", async () => {
    const created = await (await createProvider()).json();
    await db.account.create({
      data: { providerId: created.id, label: "acc-1" },
    });
    const res = await req(`/admin/providers/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: "provider_has_accounts" } });
  });
});
