import { Hono } from "hono";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { decryptSecret } from "../lib/crypto.ts";

/**
 * Real upstream reachability probe: GET {baseUrl}/models with the decrypted key.
 * The key is decrypted in memory only and never appears in the response.
 */
export function testConnectionRouter(db: Db, masterKey: Buffer) {
  const r = new Hono();

  r.post("/accounts/:id/test", async (c) => {
    const accountId = c.req.param("id");
    const account = await db.account.findUnique({
      where: { id: accountId },
      include: { credential: true, provider: true },
    });
    if (!account) throw new ApiError(404, "not_found", "account not found");
    if (!account.credential) {
      throw new ApiError(409, "missing_credential", "account has no credential to test");
    }
    const baseUrl = (account.baseUrl ?? account.provider.baseUrl)?.replace(/\/+$/, "");
    if (!baseUrl) throw new ApiError(500, "internal_error", "no baseUrl configured");
    const apiKey = decryptSecret(account.credential.enc, masterKey);

    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          "user-agent": "passe-trou/0.1",
        },
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel();
      return c.json({ ok: res.ok, httpStatus: res.status, latencyMs: Date.now() - start });
    } catch {
      return c.json({ ok: false, latencyMs: Date.now() - start });
    }
  });

  return r;
}
