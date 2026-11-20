"use client";

// Logical-model create/rename/delete drawers plus the Map-account drawer.
// The account select is fed from GET /admin/overview (no global account-list route exists).

import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import type { LogicalModel } from "@/lib/admin";
import type { Overview, OverviewAccount } from "@/lib/overview";
import { ConfirmDrawer } from "@/components/ConfirmDrawer";
import { Drawer } from "@/components/Drawer";
import { Field, SelectInput, TextInput } from "@/components/fields";

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("request_failed", error instanceof Error ? error.message : String(error), 0);
}

export function ModelDrawer({
  open,
  onClose,
  model,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  model: LogicalModel | null; // null = create
  onSaved: () => void;
}) {
  const edit = model !== null;
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDisplayName(model?.displayName ?? "");
    setPending(false);
    setError(null);
  }, [open, model]);

  const submit = async () => {
    const name = displayName.trim();
    if (!name) {
      setError("A name is required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (edit) {
        await apiFetch(`/admin/models/${model.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: name }),
        });
      } else {
        await apiFetch("/admin/models", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: name }),
        });
      }
      onSaved();
    } catch (e) {
      const err = toApiError(e);
      setError(`${err.code}: ${err.message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title={edit ? "Rename model" : "New model"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field
          label="Name"
          error={error}
          hint="The public name members call as /v1/chat/completions model:"
        >
          <TextInput
            value={displayName}
            onChange={setDisplayName}
            autoFocus
            disabled={pending}
            placeholder="fast-flash"
          />
        </Field>
        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-[var(--control-height)] rounded-control px-3 text-sm text-muted hover:text-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-[var(--control-height)] rounded-control border border-control px-4 text-sm text-text hover:border-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : edit ? "Rename" : "Create model"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

export function DeleteModelDrawer({
  open,
  onClose,
  model,
  onDeleted,
  error,
}: {
  open: boolean;
  onClose: () => void;
  model: LogicalModel | null;
  onDeleted: () => Promise<void>;
  error: unknown;
}) {
  return (
    <ConfirmDrawer
      open={open}
      onClose={onClose}
      title={`Delete ${model?.displayName ?? "model"}`}
      consequence="The logical model stops being callable at once; the API answers 409 while mappings or key allowlists still reference it."
      confirmLabel="Delete model"
      error={error}
      onConfirm={onDeleted}
    />
  );
}

export function MapAccountDrawer({
  open,
  onClose,
  model,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  model: LogicalModel | null;
  onSaved: () => void;
}) {
  const [candidates, setCandidates] = useState<OverviewAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [upstreamModel, setUpstreamModel] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !model) return;
    setCandidates(null);
    setAccountId("");
    setUpstreamModel("");
    setPending(false);
    setErrors({});
    let cancelled = false;
    apiFetch<Overview>("/admin/overview")
      .then((o) => {
        if (cancelled) return;
        const mapped = new Set(model.mappings.map((m) => m.accountId));
        const list = o.accounts.filter((a) => !mapped.has(a.id));
        setCandidates(list);
        setAccountId(list[0]?.id ?? "");
      })
      .catch((e) => {
        if (cancelled) return;
        setErrors({ form: `${toApiError(e).code}: ${toApiError(e).message}` });
        setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, model]);

  const submit = async () => {
    if (!model || !accountId) return;
    setPending(true);
    setErrors({});
    try {
      await apiFetch(`/admin/models/${model.id}/mappings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          ...(upstreamModel.trim() ? { upstreamModel: upstreamModel.trim() } : {}),
        }),
      });
      onSaved();
    } catch (e) {
      const err = toApiError(e);
      const haystack = `${err.code} ${err.message}`.toLowerCase();
      setErrors(
        haystack.includes("upstream")
          ? { upstreamModel: err.message }
          : haystack.includes("account")
            ? { accountId: err.message }
            : { form: `${err.code}: ${err.message}` },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Map an account to ${model?.displayName ?? "model"}`}
    >
      {candidates === null ? (
        <p className="text-body text-muted">Reading the account list…</p>
      ) : candidates.length === 0 && !errors.form ? (
        <p className="text-body text-muted">
          Every account is already mapped to this model — add an account on the Providers page
          first.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field label="Account" error={errors.accountId}>
            <SelectInput
              value={accountId}
              onChange={setAccountId}
              options={candidates.map((a) => ({
                id: a.id,
                label: `${a.provider} · ${a.label}${a.enabled ? "" : " (benched)"}`,
              }))}
              disabled={pending}
              ariaLabel="Account to map"
            />
          </Field>
          <Field
            label="Upstream model"
            error={errors.upstreamModel}
            hint="The name the provider expects; defaults to the logical name when empty."
          >
            <TextInput
              value={upstreamModel}
              onChange={setUpstreamModel}
              placeholder={model?.displayName}
              disabled={pending}
            />
          </Field>
          {errors.form && (
            <p className="text-body text-negative" role="alert">
              {errors.form}
            </p>
          )}
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-[var(--control-height)] rounded-control px-3 text-sm text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !accountId}
              className="h-[var(--control-height)] rounded-control border border-control px-4 text-sm text-text hover:border-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "Map account"}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}
