import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type { Member } from "../generated/prisma/client.ts";

const createSchema = z.object({
  displayName: z.string().trim().min(1),
  enabled: z.boolean().default(true),
});

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .partial();

function memberJson(m: Member) {
  return {
    id: m.id,
    displayName: m.name,
    enabled: m.enabled,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "request body must be valid JSON");
  }
}

async function mustGetMember(db: Db, id: string): Promise<Member> {
  const member = await db.member.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "not_found", "member not found");
  return member;
}

async function assertNameFree(db: Db, displayName: string, excludeId?: string) {
  const clash = await db.member.findFirst({
    where: { name: displayName, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (clash) throw new ApiError(409, "duplicate_name", "displayName already in use");
}

export function membersRouter(db: Db) {
  const r = new Hono();

  r.post("/members", async (c) => {
    const body = createSchema.parse(await parseJson(c));
    await assertNameFree(db, body.displayName);
    const member = await db.member.create({
      data: { name: body.displayName, enabled: body.enabled },
    });
    return c.json(memberJson(member), 201);
  });

  r.get("/members", async (c) => {
    const members = await db.member.findMany({ orderBy: { createdAt: "asc" } });
    return c.json(members.map(memberJson));
  });

  r.get("/members/:id", async (c) => {
    return c.json(memberJson(await mustGetMember(db, c.req.param("id"))));
  });

  r.patch("/members/:id", async (c) => {
    const id = c.req.param("id");
    await mustGetMember(db, id);
    const body = patchSchema.parse(await parseJson(c));
    if (body.displayName) await assertNameFree(db, body.displayName, id);
    const member = await db.member.update({
      where: { id },
      data: {
        ...(body.displayName ? { name: body.displayName } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
    });
    return c.json(memberJson(member));
  });

  r.delete("/members/:id", async (c) => {
    const member = await mustGetMember(db, c.req.param("id"));
    const keys = await db.apiKey.count({ where: { memberId: member.id } });
    if (keys > 0) {
      throw new ApiError(409, "member_has_keys", "member still has API keys");
    }
    await db.member.delete({ where: { id: member.id } });
    return c.body(null, 204);
  });

  return r;
}
