import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.ts";

const VALID = {
  DATABASE_URL: "postgresql://postgres:x@127.0.0.1:5434/passetrou",
  ENCRYPTION_MASTER_KEY: "b".repeat(64),
};

describe("loadEnv", () => {
  it("accepts a complete environment", () => {
    const env = loadEnv(VALID);
    expect(env.ENCRYPTION_MASTER_KEY).toBe(VALID.ENCRYPTION_MASTER_KEY);
  });

  it("refuses to boot without DATABASE_URL", () => {
    const { DATABASE_URL: _, ...rest } = VALID;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("refuses to boot without ENCRYPTION_MASTER_KEY", () => {
    const { ENCRYPTION_MASTER_KEY: _, ...rest } = VALID;
    expect(() => loadEnv(rest)).toThrow(/ENCRYPTION_MASTER_KEY/);
  });

  it("refuses to boot with a non-hex ENCRYPTION_MASTER_KEY", () => {
    expect(() => loadEnv({ ...VALID, ENCRYPTION_MASTER_KEY: `zz${"b".repeat(62)}` })).toThrow(
      /ENCRYPTION_MASTER_KEY/,
    );
  });

  it("refuses to boot with a too-short ENCRYPTION_MASTER_KEY", () => {
    expect(() => loadEnv({ ...VALID, ENCRYPTION_MASTER_KEY: "b".repeat(40) })).toThrow(
      /ENCRYPTION_MASTER_KEY/,
    );
  });
});
