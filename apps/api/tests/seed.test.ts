import { expect, it } from "vitest";
import { seedAdmin } from "../prisma/seed.ts";
import { db } from "./setup.ts";

it("seed creates exactly one admin member and is idempotent", async () => {
  await seedAdmin(db, "admin");
  await seedAdmin(db, "admin");

  const admins = await db.member.findMany({ where: { name: "admin" } });
  expect(admins).toHaveLength(1);
  expect(await db.member.count()).toBe(1);

  // second run kept the same row, no duplicate created
  const again = await db.member.findUniqueOrThrow({ where: { name: "admin" } });
  expect(again.id).toBe(admins[0]!.id);
});
