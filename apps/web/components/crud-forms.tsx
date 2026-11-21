"use client";

// Shared CRUD form atoms (W16): labelled field, the page's one primary creation
// control, secondary drawer buttons, typed-confirm delete drawer.

import { useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { ErrorBlock } from "@/components/ErrorBlock";
import { IconChevron } from "@/components/icons";

export const inputCls =
  "h-[38px] w-full rounded-md border border-border bg-surface px-3 text-body text-foreground outline-none focus:border-primary";

/** button-secondary: muted fill, foreground text, hover border-tone fill. */
export const btnCls =
  "h-[var(--control-height)] flex-none rounded-md bg-muted px-4 text-sm text-foreground hover:bg-border disabled:cursor-not-allowed disabled:text-secondary disabled:hover:bg-muted";

export const dangerBtnCls =
  "h-[var(--control-height)] flex-none rounded-md bg-error-surface px-4 text-sm text-error hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50";

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
      {hint && <p className="text-body text-secondary">{hint}</p>}
    </div>
  );
}

/** The one primary control per page (button-primary). */
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
      className="h-[var(--control-height)] rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover active:bg-primary-strong"
    >
      {children}
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
        <p className="text-body text-secondary">{consequence}</p>
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
      className={`inline-flex text-secondary transition-transform ${open ? "rotate-90" : ""}`}
    >
      <IconChevron />
    </span>
  );
}
