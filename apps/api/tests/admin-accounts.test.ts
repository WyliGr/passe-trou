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

async function createProvider(displayName = "CommandCode") {
  const res = await jsonReq("POST", "/admin/providers", {
    displayName,
    type: "openai-compatible",
    baseUrl: "https://api.commandcode.ai/provider/v1",
  });
  return (await res.json()) as { id: string };
}

async function createAccount(providerId: string, body: unknown = { displayName: "compte-1" }) {
  return jsonReq("POST", `/admin/providers/${providerId}/accounts`, body);
}

describe("POST /admin/providers/:id/accounts", () => {
  it("creates an account (201), defaults to active, keyPrefix null", async () => {
    const provider = await createProvider();
    const res = await createAccount(provider.id);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      providerId: provider.id,
      displayName: "compte-1",
      status: "active",
      keyPrefix: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const full = JSON.stringify(body);
    expect(full).not.toContain("enc");
    expect(body.enc).toBeUndefined();
  });

  it("creates a benched account when status=benched", async () => {
    const provider = await createProvider();
    const res = await createAccount(provider.id, {
      displayName: "compte-bench",
      status: "benched",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("benched");
  });

  it("404 when the provider does not exist", async () => {
    const res = await createAccount("nope");
    expect(res.status).toBe(404);
  });

  it("409 on duplicate displayName within the same provider", async () => {
    const provider = await createProvider();
    await createAccount(provider.id);
    const res = await createAccount(provider.id);
    expect(res.status).toBe(409);
  });

  it("allows the same displayName on a different provider", async () => {
    const a = await createProvider();
    const b = await createProvider("Mistral");
    await createAccount(a.id);
    const res = await createAccount(b.id);
    expect(res.status).toBe(201);
  });

  it("400 on invalid body", async () => {
    const provider = await createProvider();
    for (const bad of [{}, { displayName: "" }, { displayName: "x", status: "dead" }]) {
      const res = await createAccount(provider.id, bad);
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /admin/providers/:id/accounts", () => {
  it("lists accounts nested under the provider", async () => {
    const provider = await createProvider();
    await createAccount(provider.id, { displayName: "a1" });
    await createAccount(provider.id, { displayName: "a2", status: "benched" });
    const other = await createProvider("Mistral");
    await createAccount(other.id, { displayName: "not-mine" });

    const res = await req(`/admin/providers/${provider.id}/accounts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((a: { displayName: string }) => a.displayName)).toEqual(["a1", "a2"]);
    expect(body[1].status).toBe("benched");

    expect((await req("/admin/providers/nope/accounts")).status).toBe(404);
  });
});

describe("GET/PATCH/DELETE /admin/accounts/:id", () => {
  it("GET returns the account incl. benched status; 404 unknown", async () => {
    const provider = await createProvider();
    const created = await (await createAccount(provider.id)).json();
    const res = await req(`/admin/accounts/${created.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("compte-1");
    expect((await req("/admin/accounts/nope")).status).toBe(404);
  });

  it("PATCH benches and reactivates an account", async () => {
    const provider = await createProvider();
    const created = await (await createAccount(provider.id)).json();
    const benched = await jsonReq("PATCH", `/admin/accounts/${created.id}`, { status: "benched" });
    expect((await benched.json()).status).toBe("benched");
    const renamed = await jsonReq("PATCH", `/admin/accounts/${created.id}`, {
      displayName: "renamed",
      status: "active",
    });
    const body = await renamed.json();
    expect(body.displayName).toBe("renamed");
    expect(body.status).toBe("active");
    // benched accounts stay visible in the nested list
    const active = await jsonReq("PATCH", `/admin/accounts/${created.id}`, { status: "benched" });
    expect(active.status).toBe(200);
    const list = await (await req(`/admin/providers/${provider.id}/accounts`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("benched");

    expect((await jsonReq("PATCH", "/admin/accounts/nope", { status: "benched" })).status).toBe(404);
  });

  it("PATCH 409 on duplicate displayName in same provider", async () => {
    const provider = await createProvider();
    await createAccount(provider.id, { displayName: "a1" });
    const second = await (await createAccount(provider.id, { displayName: "a2" })).json();
    const res = await jsonReq("PATCH", `/admin/accounts/${second.id}`, { displayName: "a1" });
    expect(res.status).toBe(409);
  });

  it("DELETE removes the account; GET afterwards is 404", async () => {
    const provider = await createProvider();
    const created = await (await createAccount(provider.id)).json();
    const res = await req(`/admin/accounts/${created.id}`, { method: "DELETE" });
    expect([200, 204]).toContain(res.status);
    expect((await req(`/admin/accounts/${created.id}`)).status).toBe(404);
    expect((await req("/admin/accounts/nope", { method: "DELETE" })).status).toBe(404);
  });

  it("account deletion cascades its credential row", async () => {
    const provider = await createProvider();
    const created = await (await createAccount(provider.id)).json();
    await db.accountCredential.create({
      data: { accountId: created.id, enc: "enc:v1:fake", last4: "1234", keyPrefix: "sk-test-" },
    });
    await req(`/admin/accounts/${created.id}`, { method: "DELETE" });
    expect(await db.accountCredential.count()).toBe(0);
  });
});
