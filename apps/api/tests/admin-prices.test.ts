import { describe, expect, it } from "vitest";
import { adminHeaders, db, testApp } from "./setup.ts";

async function seedProviderAndAccount() {
  const provider = await db.provider.create({
    data: { name: "CommandCode", kind: "openai", baseUrl: "https://api.commandcode.ai/provider/v1" },
  });
  const account = await db.account.create({
    data: { providerId: provider.id, label: "compte-1" },
  });
  return { provider, account };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    scope: "provider",
    modelMatcher: "deepseek/*",
    priceInput: 0.14,
    priceOutput: 0.28,
    ...overrides,
  };
}

describe("admin prices", () => {
  it("requires admin auth", async () => {
    const app = testApp();
    const res = await app.request("/admin/prices");
    expect(res.status).toBe(401);
  });

  it("PUT bulk-creates then GET round-trips with derived scope", async () => {
    const { provider, account } = await seedProviderAndAccount();
    const app = testApp();
    const put = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        prices: [
          entry({ providerId: provider.id }),
          entry({
            scope: "account",
            providerId: null,
            accountId: account.id,
            modelMatcher: "deepseek/deepseek-v4.1-flash",
            priceInput: 0.1,
            priceOutput: 0.2,
            priceCachedInput: 0.05,
          }),
        ],
      }),
    });
    expect(put.status).toBe(200);
    const created = (await put.json()) as Array<Record<string, unknown>>;
    expect(created).toHaveLength(2);

    const get = await app.request("/admin/prices", { headers: await adminHeaders() });
    expect(get.status).toBe(200);
    const list = (await get.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    const byMatcher = Object.fromEntries(list.map((p) => [p.modelMatcher as string, p]));
    expect(byMatcher["deepseek/*"]).toMatchObject({
      scope: "provider",
      providerId: provider.id,
      accountId: null,
      priceInput: 0.14,
      priceOutput: 0.28,
      priceCachedInput: null,
    });
    expect(byMatcher["deepseek/deepseek-v4.1-flash"]).toMatchObject({
      scope: "account",
      accountId: account.id,
      priceCachedInput: 0.05,
    });
  });

  it("PUT replaces the full set and preserves ids of entries sent back", async () => {
    const { provider } = await seedProviderAndAccount();
    const app = testApp();
    const first = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        prices: [entry({ providerId: provider.id }), entry({ providerId: provider.id, modelMatcher: "glm-*", priceInput: 1, priceOutput: 2 })],
      }),
    });
    const created = (await first.json()) as Array<{ id: string; modelMatcher: string }>;
    const kept = created.find((p) => p.modelMatcher === "deepseek/*")!;

    const second = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        prices: [{ id: kept.id, ...entry({ providerId: provider.id, priceInput: 0.2 }) }],
      }),
    });
    expect(second.status).toBe(200);
    const list = (await second.json()) as Array<{ id: string; modelMatcher: string; priceInput: number }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: kept.id, modelMatcher: "deepseek/*", priceInput: 0.2 });
  });

  it("rejects entry with both scope ids null", async () => {
    const app = testApp();
    const res = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ prices: [entry({ providerId: null })] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("rejects entry with id of the wrong scope set", async () => {
    const { account } = await seedProviderAndAccount();
    const app = testApp();
    const res = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        prices: [entry({ scope: "provider", providerId: null, accountId: account.id })],
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("rejects glob matchers beyond a single trailing *", async () => {
    const { provider } = await seedProviderAndAccount();
    const app = testApp();
    const res = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        prices: [entry({ providerId: provider.id, modelMatcher: "deep*seek*" })],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown provider/account references", async () => {
    const app = testApp();
    const res = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ prices: [entry({ providerId: "nope" })] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("404s when updating an unknown price id", async () => {
    const { provider } = await seedProviderAndAccount();
    const app = testApp();
    const res = await app.request("/admin/prices", {
      method: "PUT",
      headers: { ...await adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ prices: [{ id: "nope", ...entry({ providerId: provider.id }) }] }),
    });
    expect(res.status).toBe(404);
  });
});
