"use client";

// The shell: fixed 56px icon rail (bottom bar with 10px labels on ≤768px), accent bar on the active item.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { clearToken } from "@/lib/api";

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

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className="group relative flex h-11 w-full items-center justify-center text-muted hover:text-text max-md:h-14 max-md:flex-col max-md:justify-center max-md:gap-0.5"
    >
      {active && (
        // The selection mark: a 1px accent bar on the rail's inner edge (top edge on the phone).
        <span className="absolute right-0 top-1/2 h-[22px] w-px -translate-y-1/2 bg-accent max-md:left-1/2 max-md:right-auto max-md:top-0 max-md:h-px max-md:w-[22px] max-md:-translate-x-1/2 max-md:translate-y-0" />
      )}
      <item.Icon className={active ? "text-text" : undefined} />
      <span className="hidden text-[10px] leading-none max-md:block">{item.label}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-card bg-raised px-2 py-1 text-small text-text group-hover:block max-md:!hidden"
      >
        {item.label}
      </span>
    </Link>
  );
}

export function Rail() {
  const pathname = usePathname();
  const router = useRouter();

  const logout = () => {
    clearToken();
    router.replace("/login");
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-40 flex w-14 flex-col items-center border-r border-rule bg-ground max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-14 max-md:w-full max-md:flex-row max-md:border-r-0 max-md:border-t"
    >
      <Link
        href="/"
        aria-label="passe•trou"
        className="mt-4 mb-5 flex h-6 w-6 items-center justify-center max-md:hidden"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="var(--accent)" />
        </svg>
      </Link>
      {MONITOR.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}
      <span aria-hidden="true" className="my-3 h-px w-5 bg-rule max-md:hidden" />
      {CONFIGURE.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}
      <span className="flex-1 max-md:hidden" />
      <button
        type="button"
        onClick={logout}
        aria-label="Log out"
        className="group relative mb-4 flex h-11 w-full items-center justify-center text-muted hover:text-text max-md:mb-0 max-md:h-14 max-md:flex-col max-md:gap-0.5"
      >
        <IconLogout />
        <span className="hidden text-[10px] leading-none max-md:block">Logout</span>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-card bg-raised px-2 py-1 text-small text-text group-hover:block max-md:!hidden"
        >
          Log out
        </span>
      </button>
    </nav>
  );
}
