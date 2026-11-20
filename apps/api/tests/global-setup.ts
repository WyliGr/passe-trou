import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../src/env.ts";

/** Migrate + generate against the test database before any test file runs. */
export default function globalSetup(): void {
  loadLocalEnv();
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required for tests");
  const url = new URL(base);
  url.pathname = url.pathname.replace(/passetrou$/, "passetrou_test");
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const env = { ...process.env, DATABASE_URL: url.toString() };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd, env, stdio: "inherit" });
  execFileSync("npx", ["prisma", "generate"], { cwd, env, stdio: "inherit" });
}
