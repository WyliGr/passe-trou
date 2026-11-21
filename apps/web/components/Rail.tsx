"use client";

// The shell: fixed 56px icon rail (bottom bar with 10px labels on ≤768px). Sidebar
// rows are rounded-md 6px, secondary text; the active row is a muted fill with
// foreground text — never a primary-colour mark (DESIGN.md).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconAnalytics,
  IconLogout,
  IconMembers,
  IconModels,
  IconOverview,
  IconPricing,
  IconProviders,
  IconRequests,
} from "@/components/icons";
import { logout, me, type SessionUser } from "@/lib/api";

type NavItem = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
};

const MONITOR: NavItem[] = [
  { href: "/", label: "Overview", Icon: IconOverview },
  { href: "/analytics", label: "Analytics", Icon: IconAnalytics },
  { href: "/requests", label: "Requests", Icon: IconRequests },
];

const CONFIGURE: NavItem[] = [
  { href: "/providers", label: "Providers", Icon: IconProviders },
  { href: "/models", label: "Models", Icon: IconModels },
  { href: "/members", label: "Members", Icon: IconMembers },
  { href: "/pricing", label: "Pricing", Icon: IconPricing },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const TOOLTIP =
  "pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-small text-foreground shadow-card group-hover:block max-md:!hidden";

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className="group relative flex h-11 w-full flex-col items-center justify-center gap-0.5 text-[#7c7c7c] transition-colors hover:text-foreground max-md:h-14"
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-md ${
          active ? "bg-surface text-foreground" : "hover:bg-muted"
        }`}
      >
        <item.Icon />
      </span>
      <span className="hidden text-[10px] leading-none max-md:block">{item.label}</span>
      <span role="tooltip" className={TOOLTIP}>
        {item.label}
      </span>
    </Link>
  );
}

export function Rail() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => {});
  }, []);

  const signOut = () => {
    void logout()
      .catch(() => {})
      .finally(() => router.replace("/login"));
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-40 flex w-14 flex-col items-center border-r border-border bg-neutral max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-14 max-md:w-full max-md:flex-row max-md:border-r-0 max-md:border-t"
    >
      <Link
        href="/"
        aria-label="passe•trou"
        className="mt-4 mb-5 flex h-6 w-6 items-center justify-center max-md:hidden"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="var(--color-primary)" />
        </svg>
      </Link>
      {MONITOR.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}
      <span aria-hidden="true" className="my-3 h-px w-5 bg-border max-md:hidden" />
      {CONFIGURE.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}
      <span className="flex-1 max-md:hidden" />
      {user && (
        <div className="group relative mb-1 flex h-11 w-full items-center justify-center max-md:hidden">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-secondary"
          >
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-small text-foreground shadow-card group-hover:block"
          >
            {user.name} · {user.email}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={signOut}
        aria-label="Sign out"
        className="group relative mb-4 flex h-11 w-full flex-col items-center justify-center gap-0.5 text-secondary hover:text-foreground max-md:mb-0 max-md:h-14"
      >
        <IconLogout />
        <span className="hidden text-[10px] leading-none max-md:block">Sign out</span>
        <span role="tooltip" className={TOOLTIP}>
          Sign out
        </span>
      </button>
    </nav>
  );
}
