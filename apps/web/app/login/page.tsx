"use client";

// /login — centered 400px column: brand •, email + password fields, one primary
// submit. First boot (no account yet) adds a link to /register.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authStatus, login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authStatus()
      .then((s) => setOpen(s.open))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-[400px] max-w-full">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="8" fill="var(--accent)" />
          </svg>
          <span className="text-base font-semibold">
            passe<span className="text-accent">•</span>trou
          </span>
        </div>
        <form onSubmit={submit} className="flex flex-col">
          <label htmlFor="email" className="mb-2 text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-card border border-control bg-transparent px-3 text-text outline-none focus:border-accent"
          />
          <label htmlFor="password" className="mt-4 mb-2 text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-card border border-control bg-transparent px-3 text-text outline-none focus:border-accent"
          />
          {error && (
            <p className="mt-3 text-small text-negative" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || email.trim() === "" || password === ""}
            className="mt-6 h-[var(--control-height)] rounded-control bg-text px-4 text-sm font-medium text-ground disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {open && (
          <p className="mt-4 text-center text-small">
            <Link href="/register" className="text-muted underline hover:text-text">
              First boot — create the admin account
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
