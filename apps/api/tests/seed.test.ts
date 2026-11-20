import { expect, it } from "vitest";
import { seedAdmin, seedPresets } from "../prisma/seed.ts";
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

it("seedPresets creates CommandCode + Mistral providers and member Will, idempotent", async () => {
  await seedPresets(db);
  await seedPresets(db);

  const commandCode = await db.provider.findUniqueOrThrow({ where: { name: "CommandCode" } });
  expect(commandCode.kind).toBe("openai");
  expect(commandCode.baseUrl).toBe("https://api.commandcode.ai/provider/v1");
  const mistral = await db.provider.findUniqueOrThrow({ where: { name: "Mistral" } });
  expect(mistral.kind).toBe("openai");
  expect(mistral.baseUrl).toBe("https://api.mistral.ai/v1");

  expect(await db.provider.count()).toBe(2);
  expect(await db.member.findMany({ where: { name: "Will" } })).toHaveLength(1);
});
