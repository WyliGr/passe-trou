import { pathToFileURL } from "node:url";
import { createPrismaClient, type Db } from "../src/db.ts";
import { loadLocalEnv } from "../src/env.ts";

/** Idempotent: creates the single admin member inside a transaction; safe to run twice. */
export async function seedAdmin(
  db: Db,
  adminName = process.env.ADMIN_NAME ?? "admin",
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.member.upsert({
      where: { name: adminName },
      update: {},
      create: { name: adminName, notes: "passe•trou admin" },
    });
  });
}

/** Known provider presets, keyed on the stable unique name: re-runs converge drift. */
const PROVIDER_PRESETS = [
  { name: "CommandCode", kind: "openai", baseUrl: "https://api.commandcode.ai/provider/v1" },
  { name: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1" },
] as const;

/** Idempotent: Will's provider presets + demo member; safe to run on every deploy. */
export async function seedPresets(db: Db): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const p of PROVIDER_PRESETS) {
      await tx.provider.upsert({
        where: { name: p.name },
        update: { kind: p.kind, baseUrl: p.baseUrl },
        create: { name: p.name, kind: p.kind, baseUrl: p.baseUrl },
      });
    }
    await tx.member.upsert({
      where: { name: "Will" },
      update: {},
      create: { name: "Will", notes: "demo member" },
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createPrismaClient(url);
  try {
    await seedAdmin(db);
    await seedPresets(db);
    console.log("seeded admin member, provider presets, demo member");
  } finally {
    await db.$disconnect();
  }
}
