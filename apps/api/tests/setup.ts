import crypto from "node:crypto";
import { beforeEach } from "vitest";
import { createApp } from "../src/app.ts";
import { createPrismaClient, type Db } from "../src/db.ts";
import { loadLocalEnv } from "../src/env.ts";
import { hashPassword } from "../src/lib/passwords.ts";
import { createSession } from "../src/lib/sessions.ts";

loadLocalEnv();

export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required for tests (.env or env var)");
  const url = new URL(base);
  url.pathname = url.pathname.replace(/passetrou$/, "passetrou_test");
  return url.toString();
}

export const db: Db = createPrismaClient(testDatabaseUrl());

/** Fixed 32-byte key for all crypto tests; never used outside tests. */
export const TEST_MASTER_KEY = Buffer.from("cd".repeat(32), "hex");

export const TEST_PASSWORD = "test-password-123";
// scrypt is deliberately slow; hash one shared test password once per worker.
const TEST_PASSWORD_HASH = hashPassword(TEST_PASSWORD);

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** Fresh admin user + live session in the test DB; returns the plaintext session token. */
export async function createTestUser(): Promise<{ user: TestUser; token: string }> {
  const user = await db.user.create({
    data: {
      email: `${crypto.randomUUID()}@test.local`,
      name: "Test Admin",
      passwordHash: TEST_PASSWORD_HASH,
      role: "admin",
    },
  });
  const token = await createSession(db, user.id);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
  };
}

export function testApp(overrides: { db?: Db } = {}) {
  return createApp({
    db: overrides.db ?? db,
    masterKey: TEST_MASTER_KEY,
  });
}

export async function adminHeaders(): Promise<Record<string, string>> {
  const { token } = await createTestUser();
  return { authorization: `Bearer ${token}` };
}

/** FK-safe full reset; runs before each test in every file. */
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "requests", "idempotency_keys", "sessions", "users", "api_key_models", "api_keys", "model_accounts", "account_credentials", "prices", "accounts", "models", "providers", "members" RESTART IDENTITY CASCADE',
  );
});
