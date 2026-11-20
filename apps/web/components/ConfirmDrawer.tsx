"use client";

// Destructive-action confirm drawer: consequence in words, optional typed confirm for cascades.
// Esc/backdrop-path cancels only (Drawer closes via onClose); the confirm needs the explicit click.

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { Drawer } from "@/components/Drawer";
import { Field, TextInput } from "@/components/fields";

export function ConfirmDrawer({
  open,
  onClose,
  title,
  consequence,
  confirmLabel,
  typedName,
  pendingLabel = "Deleting…",
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The consequence in words, naming the object. */
  consequence: React.ReactNode;
  confirmLabel: string;
  /** When set, the confirm stays disabled until the input equals this name. */
  typedName?: string;
  pendingLabel?: string;
  error?: unknown;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setPending(false);
    }
  }, [open]);

  const confirmed = typedName === undefined || typed === typedName;
  const err =
    error instanceof ApiError
      ? error
      : error
        ? new ApiError("request_failed", String(error), 0)
        : null;

  return (
    <Drawer open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-muted">{consequence}</p>
        {typedName !== undefined && (
          <Field label={`Type ${typedName} to confirm`}>
            <TextInput value={typed} onChange={setTyped} disabled={pending} />
          </Field>
        )}
        {err && (
          <p className="text-body text-negative" role="alert">
            {err.code}: {err.message}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-[var(--control-height)] rounded-control px-3 text-sm text-muted hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmed || pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                // The parent keeps and renders the API error verbatim.
              } finally {
                setPending(false);
              }
            }}
            className="h-[var(--control-height)] rounded-control border border-negative px-4 text-sm text-negative hover:bg-pill-negative-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
