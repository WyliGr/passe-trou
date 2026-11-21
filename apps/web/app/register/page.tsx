"use client";

// /register — first boot only: create the admin account (name, email, password
// + confirm). Redirects to /login once registration is closed.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authStatus, register } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authStatus()
      .then((s) => {
        if (!s.open) router.replace("/login");
      })
      .catch(() => {});
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (password !== confirm) {
      setError("passwords do not match");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
      setPending(false);
    }
  };

  const incomplete =
    name.trim() === "" || email.trim() === "" || password.length < 8 || confirm === "";

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
          <label htmlFor="name" className="mb-2 text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 rounded-card border border-control bg-transparent px-3 text-text outline-none focus:border-accent"
          />
          <label htmlFor="email" className="mt-4 mb-2 text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-card border border-control bg-transparent px-3 text-text outline-none focus:border-accent"
          />
          <label htmlFor="confirm" className="mt-4 mb-2 text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-10 rounded-card border border-control bg-transparent px-3 text-text outline-none focus:border-accent"
          />
          {error && (
            <p className="mt-3 text-small text-negative" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || incomplete}
            className="mt-6 h-[var(--control-height)] rounded-control bg-text px-4 text-sm font-medium text-ground disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create the admin account"}
          </button>
        </form>
        <p className="mt-4 text-center text-small">
          <Link href="/login" className="text-muted underline hover:text-text">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
