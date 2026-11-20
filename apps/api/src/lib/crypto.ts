import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** SHA-256 hex of a passe•trou API key — the only persisted form. */
export function hashKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint a passe•trou API key: `pt_` + 32 random hex chars.
 * Plaintext is returned here (and to the admin) exactly once; only
 * keyPrefix (first 10 chars, for display) and keyHash are stored.
 */
export function generateApiKey(): { token: string; keyPrefix: string; keyHash: string } {
  const token = `pt_${randomBytes(16).toString("hex")}`;
  return { token, keyPrefix: token.slice(0, 10), keyHash: hashKey(token) };
}

/** AES-256-GCM vault for upstream credentials. Master key from env, never persisted. */

export function masterKeyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64,}$/.test(hex)) {
    throw new Error("ENCRYPTION_MASTER_KEY must be 64+ hex chars");
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

const IV_BYTES = 12;

/** Encrypt → `enc:v1:<base64 iv>:<base64 tag>:<base64 ct>`. Random IV per write. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Internal-only (proxy/test-connection). Throws on bad format, tamper, or wrong key. */
export function decryptSecret(enc: string, key: Buffer): string {
  const parts = enc.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("unsupported credential format");
  }
  const [, , ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
