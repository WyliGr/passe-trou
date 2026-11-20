import { describe, expect, it } from "vitest";
import { masterKeyFromHex } from "../src/lib/crypto.ts";

describe("masterKeyFromHex", () => {
  it("derives 32 bytes from 64 hex chars", () => {
    const key = masterKeyFromHex("ab".repeat(32));
    expect(key).toHaveLength(32);
    expect(key[0]).toBe(0xab);
  });

  it("uses the first 32 bytes when more are given", () => {
    const key = masterKeyFromHex(`${"ab".repeat(32)}ffff`);
    expect(key).toHaveLength(32);
    expect(key[0]).toBe(0xab);
  });

  it("throws on non-hex input", () => {
    expect(() => masterKeyFromHex("zz".repeat(32))).toThrow(/ENCRYPTION_MASTER_KEY/);
  });

  it("throws on short input", () => {
    expect(() => masterKeyFromHex("ab".repeat(16))).toThrow(/ENCRYPTION_MASTER_KEY/);
  });
});
