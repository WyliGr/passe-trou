import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminHeaders, testApp } from "./setup.ts";

const URL = "http://localhost";
const PLAINTEXT = "sk-testconn-secret-000";

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

async function createAccountWithKey(baseUrl: string, withKey = true) {
  const provider = await (
    await jsonReq("POST", "/admin/providers", {
      displayName: `p-${Math.random().toString(36).slice(2, 10)}`,
      type: "openai-compatible",
      baseUrl,
    })
  ).json();
  const account = await (
    await jsonReq("POST", `/admin/providers/${provider.id}/accounts`, {
      displayName: "compte-1",
    })
  ).json();
  if (withKey) {
    await jsonReq("POST", `/admin/accounts/${account.id}/credential`, { apiKey: PLAINTEXT });
  }
  return account as { id: string };
}

describe("POST /admin/accounts/:id/test", () => {
  it("returns { ok: false } quickly for an unreachable baseUrl", async () => {
    const account = await createAccountWithKey("http://127.0.0.1:1");
    const start = Date.now();
    const res = await req(`/admin/accounts/${account.id}/test`, { method: "POST" });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.latencyMs).toBe("number");
    expect(elapsed).toBeLessThan(5500);
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT);
  });

  it("409 missing_credential when the account has no credential", async () => {
    const account = await createAccountWithKey("https://api.commandcode.ai/provider/v1", false);
    const res = await req(`/admin/accounts/${account.id}/test`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "missing_credential" } });
  });

  it("404 on unknown account", async () => {
    const res = await req("/admin/accounts/nope/test", { method: "POST" });
    expect(res.status).toBe(404);
  });

  describe("against a local mock upstream", () => {
    let server: Server;
    let baseUrl: string;
    let seenAuth: string | undefined;
    let seenUa: string | undefined;

    beforeAll(async () => {
      server = createServer((req2, res2) => {
        if (req2.url === "/models") {
          seenAuth = req2.headers.authorization;
          seenUa = req2.headers["user-agent"];
          res2.writeHead(200, { "content-type": "application/json" });
          res2.end(JSON.stringify({ data: [{ id: "m1" }] }));
        } else {
          res2.writeHead(404, { "content-type": "application/json" });
          res2.end(JSON.stringify({ error: "nope" }));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it("returns { ok: true, httpStatus: 200 } and sends key+UA upstream", async () => {
      const account = await createAccountWithKey(baseUrl);
      const res = await req(`/admin/accounts/${account.id}/test`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        httpStatus: 200,
        latencyMs: expect.any(Number),
      });
      expect(seenAuth).toBe(`Bearer ${PLAINTEXT}`);
      expect(seenUa).toBe("passe-trou/0.1");
      expect(JSON.stringify(body)).not.toContain(PLAINTEXT);
    });

    it("reports ok:false with httpStatus on upstream 5xx", async () => {
      const account = await createAccountWithKey(`${baseUrl}/nothing-here`);
      const res = await req(`/admin/accounts/${account.id}/test`, { method: "POST" });
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.httpStatus).toBe(404);
    });
  });
});
