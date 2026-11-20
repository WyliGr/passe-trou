"use client";

// Shared CRUD form atoms (W16): labelled field, primary creation control (outlined, the
// 1px accent line under its label), drawer buttons, typed-confirm delete drawer.

import { useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { ErrorBlock } from "@/components/ErrorBlock";
import { IconChevron } from "@/components/icons";

export const inputCls =
  "h-[38px] w-full rounded-card border border-control bg-surface px-3 text-body text-text outline-none focus:border-muted";

export const btnCls =
  "h-[var(--control-height)] flex-none rounded-control border border-control px-4 text-sm text-text hover:border-muted disabled:cursor-not-allowed disabled:border-rule disabled:text-muted disabled:hover:border-rule";

export const dangerBtnCls =
  "h-[var(--control-height)] flex-none rounded-control border border-negative px-4 text-sm text-negative hover:border-negative disabled:cursor-not-allowed disabled:border-rule disabled:text-muted";

/** Label above the field (app-screens.md §8.1): 14px at 500, 8px gap, hint muted under. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <p className="text-body text-muted">{hint}</p>}
    </div>
  );
}

/** The one creation control per page: outlined, with the 1px accent line exactly under its label. */
export function CreateButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[var(--control-height)] rounded-control border border-control px-4 text-sm text-text hover:border-muted"
    >
      <span className="flex flex-col items-center gap-[3px]">
        <span>{children}</span>
        <span aria-hidden="true" className="h-px w-full bg-accent" />
      </span>
    </button>
  );
}

/** Typed-confirm destructive drawer: the delete button arms when the object name is typed. */
export function ConfirmDeleteDrawer({
  open,
  onClose,
  title,
  objectName,
  consequence,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What the user must type to arm the button. */
  objectName: string;
  /** The consequence, in words. */
  consequence: string;
  confirmLabel: string;
  /** Rejects with the API error → shown verbatim, drawer stays open. */
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const armed = typed === objectName;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-muted">{consequence}</p>
        <Field label={`Type ${objectName} to confirm`}>
          <input
            className={inputCls}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {error !== null && <ErrorBlock error={error} />}
        <div className="flex justify-end">
          <button
            type="button"
            className={dangerBtnCls}
            disabled={!armed || busy}
            onClick={confirm}
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

/** Quiet disclosure row used for expandable table rows. */
export function ExpandChevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex text-muted transition-transform ${open ? "rotate-90" : ""}`}
    >
      <IconChevron />
    </span>
  );
}
