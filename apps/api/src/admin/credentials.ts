import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import { encryptSecret } from "../lib/crypto.ts";

const upsertSchema = z.object({ apiKey: z.string().min(1) });

/**
 * Credential vault routes. Plaintext keys enter here and are encrypted immediately;
 * no route ever returns ciphertext or plaintext — only keyPrefix (first 8 chars).
 */
export function credentialsRouter(db: Db, masterKey: Buffer) {
  const r = new Hono();

  r.post("/accounts/:id/credential", async (c) => {
    const accountId = c.req.param("id");
    const account = await db.account.findUnique({ where: { id: accountId } });
    if (!account) throw new ApiError(404, "not_found", "account not found");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiError(400, "invalid_request", "request body must be valid JSON");
    }
    const body = upsertSchema.parse(raw);
    const credential = await db.accountCredential.upsert({
      where: { accountId },
      create: {
        accountId,
        enc: encryptSecret(body.apiKey, masterKey),
        keyPrefix: body.apiKey.slice(0, 8),
        last4: body.apiKey.slice(-4),
      },
      update: {
        enc: encryptSecret(body.apiKey, masterKey),
        keyPrefix: body.apiKey.slice(0, 8),
        last4: body.apiKey.slice(-4),
      },
    });
    return c.json({ ok: true, keyPrefix: credential.keyPrefix }, 200);
  });

  r.delete("/accounts/:id/credential", async (c) => {
    const accountId = c.req.param("id");
    const account = await db.account.findUnique({
      where: { id: accountId },
      include: { credential: { select: { id: true } } },
    });
    if (!account?.credential) {
      throw new ApiError(404, "not_found", "account credential not found");
    }
    await db.accountCredential.delete({ where: { accountId } });
    return c.body(null, 204);
  });

  return r;
}
