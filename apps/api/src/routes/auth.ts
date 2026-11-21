import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminAuth, SESSION_COOKIE } from "../admin/middleware.ts";
import { ApiError, type AppDeps } from "../app.ts";
import type { User } from "../generated/prisma/client.ts";
import { hashPassword, verifyPassword } from "../lib/passwords.ts";
import { createSession, destroySession, SESSION_TTL_MS } from "../lib/sessions.ts";

// Console account auth: first account created becomes the admin, then register
// closes forever (login only). Mounted on /auth without the admin guard except
// for /auth/me and /auth/logout, which require a live session.

const registerSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(80),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

function publicUser(user: User): { id: string; email: string; name: string; role: string } {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "request body must be valid JSON");
  }
}

// Secure only when the request itself came over https: the product ships
// plain-HTTP on the LAN (compose sets NODE_ENV=production without TLS), so a
// NODE_ENV-driven flag would make browsers drop the cookie and loop logins.
function secureFlag(c: Context): string {
  return new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
}

function sessionCookie(c: Context, token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax${secureFlag(c)}`;
}

function expiredCookie(c: Context): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag(c)}`;
}

/** Prisma unique-violation error without depending on generated error classes. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export function authRouter(deps: AppDeps) {
  const r = new Hono<{ Variables: { user: User; sessionToken: string } }>();

  r.get("/status", async (c) => {
    const count = await deps.db.user.count();
    return c.json({ open: count === 0 });
  });

  r.post("/register", async (c) => {
    const count = await deps.db.user.count();
    if (count > 0) {
      throw new ApiError(403, "registration_closed", "an account already exists");
    }
    const body = registerSchema.parse(await parseJson(c));
    let user: User;
    try {
      user = await deps.db.user.create({
        data: {
          email: body.email,
          name: body.name,
          passwordHash: hashPassword(body.password),
          role: "admin",
        },
      });
    } catch (err) {
      // Lost first-boot race: the count check passed but a concurrent register won.
      if (isUniqueViolation(err)) {
        throw new ApiError(403, "registration_closed", "an account already exists");
      }
      throw err;
    }
    const token = await createSession(deps.db, user.id);
    c.header("Set-Cookie", sessionCookie(c, token));
    return c.json({ user: publicUser(user), token }, 201);
  });

  r.post("/login", async (c) => {
    const body = loginSchema.parse(await parseJson(c));
    const user = await deps.db.user.findUnique({ where: { email: body.email } });
    // Same answer for unknown email and wrong password: no existence leak.
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new ApiError(401, "invalid_credentials", "invalid email or password");
    }
    const token = await createSession(deps.db, user.id);
    c.header("Set-Cookie", sessionCookie(c, token));
    return c.json({ user: publicUser(user), token });
  });

  r.use("/me", adminAuth(deps.db));
  r.use("/logout", adminAuth(deps.db));

  r.get("/me", (c) => {
    return c.json({ user: publicUser(c.get("user")) });
  });

  r.post("/logout", async (c) => {
    await destroySession(deps.db, c.get("sessionToken"));
    c.header("Set-Cookie", expiredCookie(c));
    return c.body(null, 204);
  });

  return r;
}
