import { z } from "zod";

/**
 * Load `.env` from the current working directory when present.
 * Existing environment variables always win over file values.
 * Missing file is fine: config can come from real env vars.
 */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No local .env file — rely on process environment.
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8477),
  ADMIN_NAME: z.string().min(1).default("admin"),
  ADMIN_TOKEN: z.string().min(32, "ADMIN_TOKEN must be at least 32 chars"),
  ENCRYPTION_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64,}$/, "ENCRYPTION_MASTER_KEY must be 64+ hex chars"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
