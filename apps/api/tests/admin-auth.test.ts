import { describe, expect, it } from "vitest";
import { adminHeaders, db, testApp, TEST_ADMIN_TOKEN } from "./setup.ts";

async function expectErrorShape(res: Response, status: number) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body).toMatchObject({
    error: { code: expect.any(String), message: expect.any(String) },
  });
}

describe("admin auth", () => {
  it("rejects /admin/* without Authorization header", async () => {
    const res = await testApp().request("http://localhost/admin/providers");
    await expectErrorShape(res, 401);
  });

  it("rejects /admin/* with a wrong token", async () => {
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: { authorization: "Bearer wrong-token-wrong-token-wrong" },
    });
    await expectErrorShape(res, 401);
  });

  it("rejects unknown /admin/* paths without auth (no existence leak)", async () => {
    const res = await testApp().request("http://localhost/admin/nope");
    await expectErrorShape(res, 401);
  });

  it("rejects a malformed Authorization scheme", async () => {
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: { authorization: `Basic ${TEST_ADMIN_TOKEN}` },
    });
    await expectErrorShape(res, 401);
  });

  it("accepts the configured token", async () => {
    const res = await testApp().request("http://localhost/admin/providers", {
      headers: adminHeaders(),
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
    // Proxy space has its own key auth (Task 8): an admin-token 401 must never
    // appear there. No key → proxy-domain 401 (invalid_api_key), and the admin
    // token itself does not open /v1/*.
    const anon = await testApp().request("http://localhost/v1/models");
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { error: { code: string } }).error.code).toBe("invalid_api_key");

    const withAdmin = await testApp().request("http://localhost/v1/models", {
      headers: adminHeaders(),
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
