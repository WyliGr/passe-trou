import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/db.ts";
import { testApp } from "./setup.ts";

describe("GET /db/health", () => {
  it("returns 200 when the database is up", async () => {
    const res = await testApp().request("http://localhost/db/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 503 with the error shape when the database is down", async () => {
    const dead = createPrismaClient("postgresql://postgres:x@127.0.0.1:1/passetrou_test");
    try {
      const res = await testApp({ db: dead }).request("http://localhost/db/health");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: expect.any(String), message: expect.any(String) },
      });
    } finally {
      await dead.$disconnect();
    }
  });
});
