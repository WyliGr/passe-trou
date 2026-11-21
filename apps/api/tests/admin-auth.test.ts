import { describe, expect, it } from "vitest";
import { adminHeaders, createTestUser, db, testApp } from "./setup.ts";

async function expectErrorShape(res: Response, status: number) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body).toMatchObject({
    error: { code: expect.any(String), message: expect.any(String) },
  });
}

describe("admin auth", () => {
  it("rejects /admin/* without credentials", async () => {
    const res = await testApp().request("http://localhost/admin/providers");
    await expectErrorShape(res, 401);
  });

  it("rejects an unknown session token", async () => {
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: { authorization: "Bearer wrong-token-wrong-token-wrong" },
    });
    await expectErrorShape(res, 401);
  });

  it("rejects an expired session", async () => {
    const { token } = await createTestUser();
    await db.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: { authorization: `Bearer ${token}` },
    });
    await expectErrorShape(res, 401);
  });

  it("rejects unknown /admin/* paths without auth (no existence leak)", async () => {
    const res = await testApp().request("http://localhost/admin/nope");
    await expectErrorShape(res, 401);
  });

  it("rejects a malformed Authorization scheme", async () => {
    const { token } = await createTestUser();
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: { authorization: `Basic ${token}` },
    });
    await expectErrorShape(res, 401);
  });

  it("accepts a live session via Bearer", async () => {
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: await adminHeaders(),
    });
    expect(res.status).not.toBe(401);
  });

  it("accepts a live session via the pt_session cookie", async () => {
    const { token } = await createTestUser();
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: { cookie: `pt_session=${token}` },
    });
    expect(res.status).not.toBe(401);
  });

  it("GET /healthz stays reachable without auth", async () => {
    const res = await testApp().request("http://localhost/healthz");
    expect(res.status).toBe(200);
  });

  it("GET /db/health stays reachable without auth", async () => {
    const res = await testApp().request("http://localhost/db/health");
    expect(res.status).toBe(200);
  });

  it("/v1/* space is not behind admin auth", async () => {
    // Proxy space has its own key auth (Task 8): an admin-auth 401 must never
    // appear there. No key → proxy-domain 401 (invalid_api_key), and a console
    // session token does not open /v1/*.
    const anon = await testApp().request("http://localhost/v1/models");
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { error: { code: string } }).error.code).toBe("invalid_api_key");

    const withAdmin = await testApp().request("http://localhost/v1/models", {
      headers: await adminHeaders(),
    });
    expect(withAdmin.status).toBe(401);
    expect(((await withAdmin.json()) as { error: { code: string } }).error.code).toBe("invalid_api_key");
  });
});

describe("test db sanity", () => {
  it("uses the passetrou_test database", async () => {
    const rows = await db.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    expect(rows[0]?.current_database).toBe("passetrou_test");
  });
});
