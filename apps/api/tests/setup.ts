import { beforeEach } from "vitest";
import { createApp } from "../src/app.ts";
import { createPrismaClient, type Db } from "../src/db.ts";
import { loadLocalEnv } from "../src/env.ts";

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
export const TEST_ADMIN_TOKEN = "test-admin-token-c2VyeC1zZWNyZXQ";

export function testApp(overrides: { db?: Db; adminToken?: string } = {}) {
  return createApp({
    db: overrides.db ?? db,
    adminToken: overrides.adminToken ?? TEST_ADMIN_TOKEN,
    masterKey: TEST_MASTER_KEY,
  });
}

export function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
}

/** FK-safe full reset; runs before each test in every file. */
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "requests", "idempotency_keys", "api_key_models", "api_keys", "model_accounts", "account_credentials", "prices", "accounts", "models", "providers", "members" RESTART IDENTITY CASCADE',
  );
});
