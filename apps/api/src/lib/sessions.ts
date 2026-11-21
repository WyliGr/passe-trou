import crypto from "node:crypto";
import type { Db } from "../db.ts";
import type { User } from "../generated/prisma/client.ts";

// Console sessions: opaque bearer token, sha256 stored server-side, fixed 30d TTL.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Creates a session row for the user and returns the plaintext token (never stored). */
export async function createSession(db: Db, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

/** Resolves a session token to its user; unknown or expired → null. */
export async function getUserByToken(db: Db, token: string): Promise<User | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session.user;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
