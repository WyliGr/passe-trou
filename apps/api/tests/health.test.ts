import { describe, expect, it } from "vitest";
import { testApp } from "./setup.ts";

describe("health probes", () => {
  it("GET /healthz returns 200 { ok: true }", async () => {
    const res = await testApp().request("http://localhost/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unknown route returns 404 with the consistent error shape", async () => {
    const res = await testApp().request("http://localhost/no-such-route");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });
});
