"use client";

// Guards every shell route: server-side middleware checks the pt_session
// cookie, this confirms the session is still live via /auth/me (a revoked
// session 401s and bounces to /login). Renders nothing until checked.

import { useEffect, useState } from "react";
import { me } from "@/lib/api";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    me()
      .then(() => setAllowed(true))
      .catch(() => {
        // 401 → apiFetch already redirected to /login
      });
  }, []);

  if (!allowed) return null;
  return <>{children}</>;
}
