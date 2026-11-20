"use client";

// /login — centered 400px column: brand •, an Admin token password field, one primary submit.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [token, setTokenValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = token.trim();
    if (!candidate || pending) return;
    setPending(true);
    setError(null);
    // Validate against the cheapest admin route before storing the token.
    try {
      window.localStorage.setItem("pt_admin_token", candidate);
      await apiFetch("/admin/overview");
      setToken(candidate);
      router.replace("/");
    } catch (err) {
      window.localStorage.removeItem("pt_admin_token");
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
          <label htmlFor="admin-token" className="mb-2 text-sm font-medium">
            Admin token
          </label>
          <input
            id="admin-token"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            className="h-10 rounded-card border border-control bg-transparent px-3 text-text outline-none focus:border-accent"
          />
          {error && (
            <p className="mt-3 text-small text-negative" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || token.trim() === ""}
            className="mt-6 h-[var(--control-height)] rounded-control bg-text px-4 text-sm font-medium text-ground disabled:opacity-50"
          >
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
