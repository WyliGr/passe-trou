import { describe, expect, it } from "vitest";
import { decryptSecret } from "../src/lib/crypto.ts";
import { adminHeaders, db, TEST_MASTER_KEY, testApp } from "./setup.ts";

const URL = "http://localhost";
const PLAINTEXT = "sk-super-secret-key-abcdef123456";

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

async function createAccount() {
  const provider = await (
    await jsonReq("POST", "/admin/providers", {
      displayName: "CommandCode",
      type: "openai-compatible",
      baseUrl: "https://api.commandcode.ai/provider/v1",
    })
  ).json();
  const account = await (
    await jsonReq("POST", `/admin/providers/${provider.id}/accounts`, {
      displayName: "compte-1",
    })
  ).json();
  return account as { id: string };
}

describe("POST /admin/accounts/:id/credential", () => {
  it("upserts a credential: 200, keyPrefix returned, ciphertext in DB (no plaintext)", async () => {
    const account = await createAccount();
    const res = await jsonReq("POST", `/admin/accounts/${account.id}/credential`, {
      apiKey: PLAINTEXT,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ keyPrefix: "sk-super" });
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT);

    const row = await db.accountCredential.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(row.enc).toMatch(/^enc:v1:/);
    expect(row.enc).not.toContain(PLAINTEXT);
    expect(row.keyPrefix).toBe("sk-super");
    expect(decryptSecret(row.enc, TEST_MASTER_KEY)).toBe(PLAINTEXT);
  });

  it("upsert replaces an existing credential (still one row)", async () => {
    const account = await createAccount();
    await jsonReq("POST", `/admin/accounts/${account.id}/credential`, { apiKey: PLAINTEXT });
    const next = "sk-rotated-key-999";
    const res = await jsonReq("POST", `/admin/accounts/${account.id}/credential`, {
      apiKey: next,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).keyPrefix).toBe("sk-rotat");
    const rows = await db.accountCredential.findMany({ where: { accountId: account.id } });
    expect(rows).toHaveLength(1);
    expect(decryptSecret(rows[0]!.enc, TEST_MASTER_KEY)).toBe(next);
  });

  it("404 on unknown account, 400 on missing apiKey", async () => {
    expect(
      (await jsonReq("POST", "/admin/accounts/nope/credential", { apiKey: "x" })).status,
    ).toBe(404);
    const account = await createAccount();
    expect((await jsonReq("POST", `/admin/accounts/${account.id}/credential`, {})).status).toBe(
      400,
    );
  });

  it("account show/list expose keyPrefix and never plaintext", async () => {
    const account = await createAccount();
    await jsonReq("POST", `/admin/accounts/${account.id}/credential`, { apiKey: PLAINTEXT });

    const providerId = (await db.account.findUniqueOrThrow({ where: { id: account.id } }))
      .providerId;
    for (const path of [
      `/admin/accounts/${account.id}`,
      `/admin/providers/${providerId}/accounts`,
    ]) {
      const res = await req(path);
      const text = JSON.stringify(await res.json());
      expect(text).toContain("sk-super");
      expect(text).not.toContain(PLAINTEXT);
      expect(text).not.toContain("enc:v1");
    }
  });
});

describe("DELETE /admin/accounts/:id/credential", () => {
  it("removes the credential row (204); 404 when none", async () => {
    const account = await createAccount();
    expect((await req(`/admin/accounts/${account.id}/credential`, { method: "DELETE" })).status).toBe(
      404,
    );
    await jsonReq("POST", `/admin/accounts/${account.id}/credential`, { apiKey: PLAINTEXT });
    const res = await req(`/admin/accounts/${account.id}/credential`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await db.accountCredential.count({ where: { accountId: account.id } })).toBe(0);
    const listed = await req(`/admin/accounts/${account.id}`);
    expect((await listed.json()).keyPrefix).toBeNull();
    expect((await req(`/admin/accounts/nope/credential`, { method: "DELETE" })).status).toBe(404);
  });
});
