import { describe, expect, it } from "vitest";
import { adminHeaders, db, testApp } from "./setup.ts";

const URL = "http://localhost";
const TOKEN_RE = /^pt_[0-9a-f]{32}$/;

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

async function createMember(displayName = "Chloé") {
  const res = await jsonReq("POST", "/admin/members", { displayName });
  return (await res.json()) as { id: string };
}

async function createModel(displayName: string) {
  const res = await jsonReq("POST", "/admin/models", { displayName });
  return (await res.json()) as { id: string };
}

async function createKey(memberId: string, body: unknown = { label: "heermes" }) {
  return jsonReq("POST", `/admin/members/${memberId}/keys`, body);
}

describe("POST /admin/members/:id/keys", () => {
  it("creates a key (201) returning the plaintext token exactly once", async () => {
    const member = await createMember();
    const res = await createKey(member.id);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(TOKEN_RE);
    expect(body).toMatchObject({
      id: expect.any(String),
      keyPrefix: body.token.slice(0, 10),
      label: "heermes",
      enabled: true,
      createdAt: expect.any(String),
    });
  });

  it("stores sha256 hex and prefix only — no plaintext anywhere in the DB row", async () => {
    const member = await createMember();
    const body = await (await createKey(member.id)).json();
    const row = await db.apiKey.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.prefix).toBe(body.keyPrefix);
    expect(JSON.stringify(row)).not.toContain(body.token);
  });

  it("creates a disabled key when enabled=false", async () => {
    const member = await createMember();
    const res = await createKey(member.id, { label: "vox", enabled: false });
    expect(res.status).toBe(201);
    expect((await res.json()).enabled).toBe(false);
  });

  it("404 on unknown member", async () => {
    expect((await createKey("nope")).status).toBe(404);
  });

  it("400 on invalid body", async () => {
    const member = await createMember();
    for (const bad of [{}, { label: "" }, { label: 42 }]) {
      const res = await createKey(member.id, bad);
      expect(res.status).toBe(400);
    }
  });

  it("401 without admin token", async () => {
    const member = await createMember();
    const res = await testApp().request(`${URL}/admin/members/${member.id}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/members/:id/keys", () => {
  it("lists keys without the token; 404 unknown member", async () => {
    const member = await createMember();
    const created = await (await createKey(member.id)).json();
    await createKey(member.id, { label: "vox" });

    const res = await req(`/admin/members/${member.id}/keys`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: created.id,
      keyPrefix: created.keyPrefix,
      label: "heermes",
      enabled: true,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain(created.token);
    expect(body[0].token).toBeUndefined();

    expect((await req("/admin/members/nope/keys")).status).toBe(404);
  });
});

describe("GET/PATCH/DELETE /admin/keys/:id", () => {
  it("GET returns a key without the token; 404 unknown", async () => {
    const member = await createMember();
    const created = await (await createKey(member.id)).json();
    const res = await req(`/admin/keys/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyPrefix).toBe(created.keyPrefix);
    expect(JSON.stringify(body)).not.toContain(created.token);
    expect((await req("/admin/keys/nope")).status).toBe(404);
  });

  it("PATCH updates label and enabled without exposing the token", async () => {
    const member = await createMember();
    const created = await (await createKey(member.id)).json();
    const res = await jsonReq("PATCH", `/admin/keys/${created.id}`, {
      label: "orion",
      enabled: false,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.label).toBe("orion");
    expect(body.enabled).toBe(false);
    expect(JSON.stringify(body)).not.toContain(created.token);
    expect(
      (await jsonReq("PATCH", "/admin/keys/nope", { label: "x" })).status,
    ).toBe(404);
  });

  it("disabled keys stay listed", async () => {
    const member = await createMember();
    const created = await (await createKey(member.id)).json();
    await jsonReq("PATCH", `/admin/keys/${created.id}`, { enabled: false });
    const list = await (await req(`/admin/members/${member.id}/keys`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].enabled).toBe(false);
  });

  it("DELETE removes the key (204); 404 afterwards", async () => {
    const member = await createMember();
    const created = await (await createKey(member.id)).json();
    const res = await req(`/admin/keys/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await req(`/admin/keys/${created.id}`)).status).toBe(404);
    expect((await req("/admin/keys/nope", { method: "DELETE" })).status).toBe(404);
  });
});

describe("PUT/GET /admin/keys/:id/models", () => {
  it("PUT sets the allowlist; GET reads back ids + names", async () => {
    const member = await createMember();
    const key = await (await createKey(member.id)).json();
    const a = await createModel("fast-flash");
    const b = await createModel("brain-pro");

    const put = await jsonReq("PUT", `/admin/keys/${key.id}/models`, {
      modelIds: [a.id, b.id],
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual([
      { id: a.id, displayName: "fast-flash" },
      { id: b.id, displayName: "brain-pro" },
    ]);

    const res = await req(`/admin/keys/${key.id}/models`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: a.id, displayName: "fast-flash" },
      { id: b.id, displayName: "brain-pro" },
    ]);
  });

  it("PUT full-replaces: swapping to a subset drops the rest", async () => {
    const member = await createMember();
    const key = await (await createKey(member.id)).json();
    const a = await createModel("fast-flash");
    const b = await createModel("brain-pro");
    await jsonReq("PUT", `/admin/keys/${key.id}/models`, { modelIds: [a.id, b.id] });

    const put = await jsonReq("PUT", `/admin/keys/${key.id}/models`, { modelIds: [b.id] });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual([{ id: b.id, displayName: "brain-pro" }]);
    expect(await (await req(`/admin/keys/${key.id}/models`)).json()).toEqual([
      { id: b.id, displayName: "brain-pro" },
    ]);
  });

  it("empty allowlist is the wildcard (all enabled models allowed)", async () => {
    const member = await createMember();
    const key = await (await createKey(member.id)).json();
    expect(await (await req(`/admin/keys/${key.id}/models`)).json()).toEqual([]);

    const put = await jsonReq("PUT", `/admin/keys/${key.id}/models`, { modelIds: [] });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual([]);
  });

  it("dedupes repeated model ids", async () => {
    const member = await createMember();
    const key = await (await createKey(member.id)).json();
    const a = await createModel("fast-flash");
    const put = await jsonReq("PUT", `/admin/keys/${key.id}/models`, {
      modelIds: [a.id, a.id],
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual([{ id: a.id, displayName: "fast-flash" }]);
  });

  it("400 on unknown model id; allowlist unchanged", async () => {
    const member = await createMember();
    const key = await (await createKey(member.id)).json();
    const a = await createModel("fast-flash");
    await jsonReq("PUT", `/admin/keys/${key.id}/models`, { modelIds: [a.id] });

    const res = await jsonReq("PUT", `/admin/keys/${key.id}/models`, {
      modelIds: [a.id, "nope"],
    });
    expect(res.status).toBe(400);
    expect(await (await req(`/admin/keys/${key.id}/models`)).json()).toEqual([
      { id: a.id, displayName: "fast-flash" },
    ]);
  });

  it("400 on invalid body; 404 on unknown key", async () => {
    const member = await createMember();
    const key = await (await createKey(member.id)).json();
    for (const bad of [{}, { modelIds: "x" }, { modelIds: [42] }]) {
      expect(
        (await jsonReq("PUT", `/admin/keys/${key.id}/models`, bad)).status,
      ).toBe(400);
    }
    expect(
      (await jsonReq("PUT", "/admin/keys/nope/models", { modelIds: [] })).status,
    ).toBe(404);
    expect((await req("/admin/keys/nope/models")).status).toBe(404);
  });
});
