import { describe, expect, it } from "vitest";
import { computeCost, type PriceLike } from "../src/lib/cost.ts";

// Plan fixture: provider-wide glob 0.14/0.28; account-exact 0.10/0.20 with cached 0.05.
const FIXTURE: PriceLike[] = [
  {
    id: "p-prov-glob",
    providerId: "prov1",
    accountId: null,
    modelMatcher: "deepseek/*",
    priceInput: 0.14,
    priceOutput: 0.28,
    priceCachedInput: null,
  },
  {
    id: "p-acct-exact",
    providerId: null,
    accountId: "acct1",
    modelMatcher: "deepseek/deepseek-v4.1-flash",
    priceInput: 0.1,
    priceOutput: 0.2,
    priceCachedInput: 0.05,
  },
];

const M1 = 1_000_000;

describe("computeCost — plan fixture math", () => {
  const base = {
    accountId: "acct1",
    providerId: "prov1",
    upstreamModel: "deepseek/deepseek-v4.1-flash",
  };

  it("account-exact: 1M in + 1M out = 0.30", () => {
    const cost = computeCost(
      { ...base, promptTokens: M1, completionTokens: M1 },
      FIXTURE,
    );
    expect(cost).toBeCloseTo(0.3, 10);
  });

  it("account-exact with 500k cached: cached at 0.05, rest at 0.10 = 0.275", () => {
    const cost = computeCost(
      { ...base, promptTokens: M1, completionTokens: M1, cachedTokens: 500_000 },
      FIXTURE,
    );
    expect(cost).toBeCloseTo(0.275, 10);
  });

  it("provider-glob fallback for another account: 1M in + 1M out = 0.42", () => {
    const cost = computeCost(
      {
        accountId: "acct2",
        providerId: "prov1",
        upstreamModel: "deepseek/deepseek-v4.1-flash",
        promptTokens: M1,
        completionTokens: M1,
      },
      FIXTURE,
    );
    expect(cost).toBeCloseTo(0.42, 10);
  });

  it("cached tokens billed at input rate when no cached price set", () => {
    const cost = computeCost(
      {
        accountId: "acct2",
        providerId: "prov1",
        upstreamModel: "deepseek/deepseek-v4.1-flash",
        promptTokens: M1,
        completionTokens: M1,
        cachedTokens: 500_000,
      },
      FIXTURE,
    );
    expect(cost).toBeCloseTo(0.42, 10);
  });

  it("unknown model → null", () => {
    const cost = computeCost(
      { ...base, upstreamModel: "glm-x", promptTokens: M1, completionTokens: M1 },
      FIXTURE,
    );
    expect(cost).toBeNull();
  });

  it("null completionTokens → null", () => {
    const cost = computeCost(
      { ...base, promptTokens: M1, completionTokens: null },
      FIXTURE,
    );
    expect(cost).toBeNull();
  });

  it("null promptTokens → null", () => {
    const cost = computeCost(
      { ...base, promptTokens: null, completionTokens: M1 },
      FIXTURE,
    );
    expect(cost).toBeNull();
  });
});

describe("computeCost — precedence tiers", () => {
  const prices: PriceLike[] = [
    { id: "pg", providerId: "p", accountId: null, modelMatcher: "m*", priceInput: 1, priceOutput: 1, priceCachedInput: null },
    { id: "ag", providerId: null, accountId: "a", modelMatcher: "m*", priceInput: 2, priceOutput: 2, priceCachedInput: null },
    { id: "pe", providerId: "p", accountId: null, modelMatcher: "m1", priceInput: 3, priceOutput: 3, priceCachedInput: null },
    { id: "ae", providerId: null, accountId: "a", modelMatcher: "m1", priceInput: 4, priceOutput: 4, priceCachedInput: null },
  ];
  const args = { accountId: "a", providerId: "p", upstreamModel: "m1", promptTokens: M1, completionTokens: 0 };

  it("account-exact > provider-exact > account-glob > provider-glob", () => {
    expect(computeCost(args, prices)).toBeCloseTo(4, 10);
    expect(computeCost(args, prices.filter((p) => p.id !== "ae"))).toBeCloseTo(3, 10);
    expect(computeCost(args, prices.filter((p) => !["ae", "pe"].includes(p.id)))).toBeCloseTo(2, 10);
    expect(
      computeCost(args, prices.filter((p) => !["ae", "pe", "ag"].includes(p.id))),
    ).toBeCloseTo(1, 10);
  });

  it("other accounts/providers never match", () => {
    expect(computeCost({ ...args, accountId: "other" }, [prices[3]!])).toBeNull();
    expect(computeCost({ ...args, providerId: "other" }, [prices[2]!])).toBeNull();
  });
});
