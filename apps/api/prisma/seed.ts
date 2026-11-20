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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createPrismaClient(url);
  try {
    await seedAdmin(db);
    console.log("seeded admin member");
  } finally {
    await db.$disconnect();
  }
}
