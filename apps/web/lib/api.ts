"use client";

// Client-side fetch wrapper: prefixes /api, cookies carry the pt_session
// automatically (same-origin via the /api rewrite), bounces to /login on 401
// for any non-auth endpoint.

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (res.status === 401) {
    // Only the credential-submit endpoints handle their own 401s; everything
    // else (expired/revoked session, stale cookie) means "back to login".
    const credentialSubmit = path === "/auth/login" || path === "/auth/register";
    if (
      !credentialSubmit &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login" &&
      window.location.pathname !== "/register"
    ) {
      window.location.assign("/login");
    }
    throw new ApiError("unauthorized", "unauthorized", 401);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      err?.error?.code ?? `http_${res.status}`,
      err?.error?.message ?? res.statusText,
      res.status,
    );
  }
  return body as T;
}

export async function authStatus(): Promise<{ open: boolean }> {
  return apiFetch<{ open: boolean }>("/auth/status");
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const body = await apiFetch<{ user: SessionUser }>("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return body.user;
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<SessionUser> {
  const body = await apiFetch<{ user: SessionUser }>("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name, password }),
  });
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function me(): Promise<SessionUser> {
  const body = await apiFetch<{ user: SessionUser }>("/auth/me");
  return body.user;
}
