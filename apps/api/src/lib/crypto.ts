/** AES-256-GCM vault for upstream credentials. Master key from env, never persisted. */

export function masterKeyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64,}$/.test(hex)) {
    throw new Error("ENCRYPTION_MASTER_KEY must be 64+ hex chars");
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}
