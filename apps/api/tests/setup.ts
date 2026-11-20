import { beforeEach } from "vitest";
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

/** FK-safe full reset; runs before each test in every file. */
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "requests", "idempotency_keys", "api_key_models", "api_keys", "model_accounts", "account_credentials", "prices", "accounts", "models", "providers", "members" RESTART IDENTITY CASCADE',
  );
});
