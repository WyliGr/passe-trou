"use client";

// Right detail drawer: 480px, --surface fill, 1px --rule left edge. Esc or the X closes.

import { useEffect } from "react";
import { IconClose } from "@/components/icons";

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      role="dialog"
      aria-label={title}
      className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l border-rule bg-surface shadow-card"
    >
      <header className="flex h-14 flex-none items-center justify-between border-b border-rule px-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center text-muted hover:text-text"
        >
          <IconClose />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </aside>
  );
}
