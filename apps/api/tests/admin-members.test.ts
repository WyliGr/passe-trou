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

async function createMember(displayName = "Chloé") {
  return jsonReq("POST", "/admin/members", { displayName });
}

describe("POST /admin/members", () => {
  it("creates a member (201), enabled by default", async () => {
    const res = await createMember();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      displayName: "Chloé",
      enabled: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("creates a disabled member when enabled=false", async () => {
    const res = await jsonReq("POST", "/admin/members", {
      displayName: "Léo",
      enabled: false,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).enabled).toBe(false);
  });

  it("409 duplicate_name on conflicting displayName", async () => {
    await createMember();
    const res = await createMember();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("duplicate_name");
  });

  it("400 on invalid body", async () => {
    for (const bad of [{}, { displayName: "" }, { displayName: 42 }]) {
      const res = await jsonReq("POST", "/admin/members", bad);
      expect(res.status).toBe(400);
    }
  });

  it("401 without admin token", async () => {
    const res = await testApp().request(`${URL}/admin/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/members", () => {
  it("lists members in creation order", async () => {
    await createMember();
    await createMember("Léo");
    const res = await req("/admin/members");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((m: { displayName: string }) => m.displayName)).toEqual(["Chloé", "Léo"]);
  });
});

describe("GET/PATCH/DELETE /admin/members/:id", () => {
  it("GET returns the member; 404 unknown", async () => {
    const member = await (await createMember()).json();
    const res = await req(`/admin/members/${member.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("Chloé");
    expect((await req("/admin/members/nope")).status).toBe(404);
  });

  it("PATCH renames and disables a member; 404 unknown", async () => {
    const member = await (await createMember()).json();
    const res = await jsonReq("PATCH", `/admin/members/${member.id}`, {
      displayName: "Chloé M.",
      enabled: false,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("Chloé M.");
    expect(body.enabled).toBe(false);
    expect(
      (await jsonReq("PATCH", "/admin/members/nope", { enabled: false })).status,
    ).toBe(404);
  });

  it("PATCH 409 duplicate_name on conflicting displayName", async () => {
    await createMember();
    const second = await (await createMember("Léo")).json();
    const res = await jsonReq("PATCH", `/admin/members/${second.id}`, {
      displayName: "Chloé",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("duplicate_name");
  });

  it("DELETE removes a member without keys (204); 404 afterwards", async () => {
    const member = await (await createMember()).json();
    const res = await req(`/admin/members/${member.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await req(`/admin/members/${member.id}`)).status).toBe(404);
    expect((await req("/admin/members/nope", { method: "DELETE" })).status).toBe(404);
  });

  it("DELETE 409 member_has_keys while keys exist", async () => {
    const member = await (await createMember()).json();
    await db.apiKey.create({
      data: {
        memberId: member.id,
        label: "heermes",
        prefix: "pt_abcdefgh",
        sha256: "a".repeat(64),
      },
    });
    const res = await req(`/admin/members/${member.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("member_has_keys");
  });
});
