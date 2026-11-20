import { expect, it } from "vitest";
import { db } from "./setup.ts";

it("migration applies cleanly: all tables exist on the test database", async () => {
  const rows = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  const tables = rows.map((r) => r.table_name);
  for (const table of [
    "providers",
    "accounts",
    "account_credentials",
    "prices",
    "models",
    "model_accounts",
    "members",
    "api_keys",
    "api_key_models",
    "requests",
    "idempotency_keys",
  ]) {
    expect(tables).toContain(table);
  }
});
