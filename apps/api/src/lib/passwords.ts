import crypto from "node:crypto";

// Password hashing with node:crypto only (no external dependency).
// Stored format: scrypt:N:r:p:<salt b64>:<hash b64>.

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const m = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(stored);
  if (!m) return false;
  // Regex guarantees all groups; defaults exist only to satisfy noUncheckedIndexedAccess.
  const [, n = "0", r = "0", p = "0", saltB64 = "", hashB64 = ""] = m;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
