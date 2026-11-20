import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, masterKeyFromHex } from "../src/lib/crypto.ts";

const KEY = masterKeyFromHex("cd".repeat(32));
const OTHER_KEY = masterKeyFromHex("ef".repeat(32));

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

describe("encryptSecret/decryptSecret", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("sk-live-secret-123", KEY);
    expect(decryptSecret(enc, KEY)).toBe("sk-live-secret-123");
  });

  it("stores in enc:v1:<iv>:<tag>:<ct> base64 format without plaintext", () => {
    const enc = encryptSecret("sk-live-secret-123", KEY);
    const parts = enc.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("enc");
    expect(parts[1]).toBe("v1");
    expect(enc).not.toContain("sk-live-secret-123");
    for (const part of parts.slice(2)) {
      expect(part).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  });

  it("uses a random IV per write (same plaintext, different ciphertext)", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("fails decryption on tampered ciphertext", () => {
    const enc = encryptSecret("sk-live-secret-123", KEY);
    const parts = enc.split(":");
    const ct = Buffer.from(parts[4]!, "base64");
    ct[0] = ct[0]! ^ 1;
    parts[4] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"), KEY)).toThrow();
  });

  it("fails decryption with the wrong master key", () => {
    const enc = encryptSecret("sk-live-secret-123", KEY);
    expect(() => decryptSecret(enc, OTHER_KEY)).toThrow();
  });

  it("rejects unknown format/prefix", () => {
    expect(() => decryptSecret("v1:aaa:bbb:ccc", KEY)).toThrow(/format/);
    expect(() => decryptSecret("not-encrypted", KEY)).toThrow(/format/);
  });
});
