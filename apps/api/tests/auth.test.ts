import { describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { createTestUser, db, testApp, TEST_PASSWORD } from "./setup.ts";

const GOOD = { email: "owner@example.com", name: "Owner", password: "correct-horse-9" };

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return testApp().request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("GET /auth/status", () => {
  it("is open when no user exists", async () => {
    const res = await testApp().request("http://localhost/auth/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ open: true });
  });

  it("is closed once a user exists", async () => {
    await createTestUser();
    const res = await testApp().request("http://localhost/auth/status");
    expect(await res.json()).toEqual({ open: false });
  });
});

describe("POST /auth/register", () => {
  it("creates the first account, returns a session and sets the cookie", async () => {
    const res = await postJson("/auth/register", GOOD);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: GOOD.email, name: GOOD.name, role: "admin" });
    expect(body.user.id).toEqual(expect.any(String));
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.token).toEqual(expect.any(String));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`pt_session=${body.token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=2592000");

    // The returned token is a live session.
    const me = await testApp().request("http://localhost/auth/me", {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.status).toBe(200);

    // The stored password is hashed, never the plaintext.
    const row = await db.user.findUnique({ where: { email: GOOD.email } });
    expect(row?.passwordHash).toMatch(/^scrypt:/);
    expect(row?.passwordHash).not.toContain(GOOD.password);
  });

  it("is closed once an account exists", async () => {
    await createTestUser();
    const res = await postJson("/auth/register", GOOD);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "registration_closed",
    );
  });

  it("maps a lost first-boot race (email unique violation) to 403 registration_closed", async () => {
    // Simulate the count-then-create race: count says open, create hits the
    // unique email constraint (Prisma P2002).
    const racingDb = {
      user: {
        count: async () => 0,
        create: async () => {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        },
      },
    } as unknown as Db;
    const res = await testApp({ db: racingDb }).request("http://localhost/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(GOOD),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "registration_closed",
    );
  });

  it("sets the Secure cookie flag only over https", async () => {
    const httpsRes = await testApp().request("https://localhost/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(GOOD),
    });
    expect(httpsRes.status).toBe(201);
    expect(httpsRes.headers.get("set-cookie") ?? "").toContain("; Secure");

    const httpRes = await postJson("/auth/register", { ...GOOD, email: "second@example.com" });
    // Register is closed now (one account exists) — use login for the http case.
    expect(httpRes.status).toBe(403);
    const loginRes = await postJson("/auth/login", { email: GOOD.email, password: GOOD.password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.headers.get("set-cookie") ?? "").not.toContain("Secure");
  });

  it("rejects a malformed email", async () => {
    const res = await postJson("/auth/register", { ...GOOD, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });

  it("rejects an empty name", async () => {
    const res = await postJson("/auth/register", { ...GOOD, name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects a name over 80 chars", async () => {
    const res = await postJson("/auth/register", { ...GOOD, name: "x".repeat(81) });
    expect(res.status).toBe(400);
  });

  it("rejects a password under 8 chars", async () => {
    const res = await postJson("/auth/register", { ...GOOD, password: "short" });
    expect(res.status).toBe(400);
    expect(await db.user.count()).toBe(0);
  });
});

describe("POST /auth/login", () => {
  it("logs in with the right password and sets the cookie", async () => {
    const { user } = await createTestUser();
    const res = await postJson("/auth/login", { email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: user.id, email: user.email });
    expect(body.token).toEqual(expect.any(String));
    expect(res.headers.get("set-cookie") ?? "").toContain(`pt_session=${body.token}`);
  });

  it("answers the same 401 for an unknown email and a wrong password", async () => {
    const { user } = await createTestUser();
    const unknown = await postJson("/auth/login", {
      email: "ghost@example.com",
      password: TEST_PASSWORD,
    });
    const wrongPw = await postJson("/auth/login", {
      email: user.email,
      password: "wrong-password",
    });
    expect(unknown.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_credentials",
    );
    expect(((await wrongPw.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_credentials",
    );
  });
});

describe("GET /auth/me", () => {
  it("returns the session user", async () => {
    const { user, token } = await createTestUser();
    const res = await testApp().request("http://localhost/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: user.id, email: user.email, name: user.name });
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("rejects without a session", async () => {
    const res = await testApp().request("http://localhost/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("destroys the session and expires the cookie", async () => {
    const { token } = await createTestUser();
    const res = await testApp().request("http://localhost/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pt_session=");
    expect(cookie).toContain("Max-Age=0");

    const after = await testApp().request("http://localhost/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it("rejects without a session", async () => {
    const res = await testApp().request("http://localhost/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
