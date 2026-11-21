"use client";

// Provider and account create/edit/delete drawers. API messages render verbatim under the field
// the message names (or under the form); every submit switches its button to "Saving…".

import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import {
  PROVIDER_TYPES,
  type Account,
  type AccountStatus,
  type Provider,
  type ProviderType,
} from "@/lib/admin";
import { ConfirmDrawer } from "@/components/ConfirmDrawer";
import { Drawer } from "@/components/Drawer";
import { Field, SecretInput, SelectInput, TextInput } from "@/components/fields";

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("request_failed", error instanceof Error ? error.message : String(error), 0);
}

/** Verbatim API message on the field it names, else form-level. */
function splitFieldError(
  error: ApiError,
  fields: string[],
): { field: string | null; message: string } {
  const haystack = `${error.code} ${error.message}`.toLowerCase();
  for (const f of fields) {
    if (haystack.includes(f.toLowerCase())) return { field: f, message: error.message };
  }
  return { field: null, message: `${error.code}: ${error.message}` };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function FormFooter({
  submitLabel,
  pending,
  disabled,
  onCancel,
}: {
  submitLabel: string;
  pending: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="h-[var(--control-height)] rounded-md px-3 text-sm text-secondary hover:text-foreground"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending || disabled}
        className="h-[var(--control-height)] rounded-md bg-muted px-4 text-sm text-foreground hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

export function ProviderDrawer({
  open,
  onClose,
  provider,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  provider: Provider | null; // null = create
  onSaved: () => void;
}) {
  const edit = provider !== null;
  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState<ProviderType>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDisplayName(provider?.displayName ?? "");
    setType(provider?.type ?? "openai-compatible");
    setBaseUrl(provider?.baseUrl ?? "");
    setPending(false);
    setErrors({});
  }, [open, provider]);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!displayName.trim()) next.displayName = "A display name is required.";
    if (!edit && !isHttpsUrl(baseUrl.trim()))
      next.baseUrl = "The base URL must be an https:// URL.";
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      if (edit) {
        const patch: Partial<Pick<Provider, "displayName" | "baseUrl">> = {};
        if (displayName.trim() !== provider.displayName) patch.displayName = displayName.trim();
        if (baseUrl.trim() !== provider.baseUrl) patch.baseUrl = baseUrl.trim();
        await apiFetch(`/admin/providers/${provider.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
      } else {
        await apiFetch("/admin/providers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim(), type, baseUrl: baseUrl.trim() }),
        });
      }
      onSaved();
    } catch (error) {
      const e = toApiError(error);
      const { field, message } = splitFieldError(e, ["baseUrl", "base_url", "displayName", "type"]);
      setErrors(field ? { [field.includes("base") ? "baseUrl" : field]: message } : { form: message });
    } finally {
      setPending(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title={edit ? "Edit provider" : "New provider"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field label="Display name" error={errors.displayName}>
          <TextInput value={displayName} onChange={setDisplayName} autoFocus disabled={pending} />
        </Field>
        <Field
          label="Type"
          error={errors.type}
          hint={edit ? "The wire type is fixed after creation — the API does not re-type a provider." : undefined}
        >
          <SelectInput
            value={type}
            onChange={setType}
            options={PROVIDER_TYPES}
            disabled={pending || edit}
            ariaLabel="Provider wire type"
          />
        </Field>
        <Field label="Base URL" error={errors.baseUrl} hint={edit ? undefined : "The upstream root, e.g. https://api.example.com/v1"}>
          <TextInput value={baseUrl} onChange={setBaseUrl} disabled={pending} placeholder="https://" />
        </Field>
        {errors.form && (
          <p className="text-body text-error" role="alert">
            {errors.form}
          </p>
        )}
        <FormFooter
          submitLabel={edit ? "Save changes" : "Create provider"}
          pending={pending}
          onCancel={onClose}
        />
      </form>
    </Drawer>
  );
}

export function DeleteProviderDrawer({
  open,
  onClose,
  provider,
  accountCount,
  onDeleted,
  error,
}: {
  open: boolean;
  onClose: () => void;
  provider: Provider | null;
  accountCount: number;
  onDeleted: () => Promise<void>;
  error: unknown;
}) {
  return (
    <ConfirmDrawer
      open={open}
      onClose={onClose}
      title={`Delete ${provider?.displayName ?? "provider"}`}
      consequence={
        accountCount > 0
          ? `Still serving ${accountCount} account${accountCount === 1 ? "" : "s"} — the API blocks the delete (409). Delete or move the accounts first.`
          : "The provider record is removed; mapped models keep no reference to it."
      }
      confirmLabel="Delete provider"
      error={error}
      onConfirm={onDeleted}
    />
  );
}

const ACCOUNT_STATUSES: readonly { id: AccountStatus; label: string }[] = [
  { id: "active", label: "active" },
  { id: "benched", label: "benched" },
];

export function AccountDrawer({
  open,
  onClose,
  provider,
  account,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  provider: Provider;
  account: Account | null; // null = create (two steps: details → credential)
  onSaved: () => void;
}) {
  const edit = account !== null;
  const [step, setStep] = useState<"details" | "credential">("details");
  const [created, setCreated] = useState<Account | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<AccountStatus>("active");
  const [keyPrefix, setKeyPrefix] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setStep("details");
    setCreated(null);
    setDisplayName(account?.displayName ?? "");
    setStatus(account?.status ?? "active");
    setKeyPrefix(account?.keyPrefix ?? null);
    setApiKey("");
    setReplacing(false);
    setRemoving(false);
    setPending(false);
    setErrors({});
  }, [open, account]);

  const saveCredential = async (accountId: string): Promise<boolean> => {
    if (!apiKey.trim()) {
      setErrors({ apiKey: "Paste the upstream API key to store it." });
      return false;
    }
    setPending(true);
    setErrors({});
    try {
      const res = await apiFetch<{ ok: boolean; keyPrefix: string }>(
        `/admin/accounts/${accountId}/credential`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        },
      );
      setKeyPrefix(res.keyPrefix);
      return true;
    } catch (error) {
      const e = toApiError(error);
      setErrors({ apiKey: `${e.code}: ${e.message}` });
      return false;
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    if (!displayName.trim()) {
      setErrors({ displayName: "A display name is required." });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      if (edit) {
        const patch: Partial<Pick<Account, "displayName" | "status">> = {};
        if (displayName.trim() !== account.displayName) patch.displayName = displayName.trim();
        if (status !== account.status) patch.status = status;
        await apiFetch(`/admin/accounts/${account.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        onSaved();
      } else {
        const createdAccount = await apiFetch<Account>(
          `/admin/providers/${provider.id}/accounts`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ displayName: displayName.trim(), status: "active" }),
          },
        );
        setCreated(createdAccount);
        setStep("credential");
      }
    } catch (error) {
      const e = toApiError(error);
      const { field, message } = splitFieldError(e, ["displayName", "status"]);
      setErrors({ [field ?? "form"]: message });
    } finally {
      setPending(false);
    }
  };

  const title = edit ? "Edit account" : step === "credential" ? "Store the credential" : "New account";

  return (
    <Drawer open={open} onClose={onClose} title={title}>
      {step === "credential" && created ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-secondary">
            <span className="text-foreground">{created.displayName}</span> is created. Add its upstream
            API key now or later — the account cannot serve until one is stored.
          </p>
          <Field
            label="Upstream API key"
            error={errors.apiKey}
            hint="Stored encrypted; only the key prefix is kept for display."
          >
            <SecretInput
              value={apiKey}
              onChange={setApiKey}
              placeholder="sk-…"
              disabled={pending}
            />
          </Field>
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onSaved}
              disabled={pending}
              className="h-[var(--control-height)] rounded-md px-3 text-sm text-secondary hover:text-foreground"
            >
              Add later
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                if (await saveCredential(created.id)) onSaved();
              }}
              className="h-[var(--control-height)] rounded-md bg-muted px-4 text-sm text-foreground hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save credential"}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field label="Display name" error={errors.displayName}>
            <TextInput value={displayName} onChange={setDisplayName} autoFocus disabled={pending} />
          </Field>
          {edit && (
            <Field label="Status" error={errors.status} hint="Benching keeps the record and the key; the pool skips it.">
              <SelectInput
                value={status}
                onChange={setStatus}
                options={ACCOUNT_STATUSES}
                disabled={pending}
                ariaLabel="Account status"
              />
            </Field>
          )}
          {edit && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">Credential</p>
              <p className="mt-1 text-small text-secondary">
                Stored encrypted; only the key prefix is kept for display.
              </p>
              <p className="mt-2 font-mono text-body text-secondary">
                {keyPrefix ? `${keyPrefix}…` : <span className="font-sans text-warning">no credential</span>}
              </p>
              {replacing ? (
                <div className="mt-3 flex flex-col gap-3">
                  <Field label="New upstream API key" error={errors.apiKey}>
                    <SecretInput
                      value={apiKey}
                      onChange={setApiKey}
                      placeholder="sk-…"
                      disabled={pending}
                    />
                  </Field>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setReplacing(false);
                        setApiKey("");
                        setErrors({});
                      }}
                      disabled={pending}
                      className="h-[28px] rounded-md px-3 text-small text-secondary hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={async () => {
                        if (await saveCredential(account.id)) {
                          setReplacing(false);
                          setApiKey("");
                        }
                      }}
                      className="h-[28px] rounded-md bg-muted px-3 text-small text-foreground hover:bg-border disabled:opacity-50"
                    >
                      {pending ? "Saving…" : "Replace"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setReplacing(true)}
                    className="h-[28px] rounded-md bg-muted px-3 text-small text-foreground hover:bg-border"
                  >
                    Replace key
                  </button>
                  {keyPrefix &&
                    (removing ? (
                      <>
                        <span className="text-small text-secondary">Drop the stored key?</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={async () => {
                            setPending(true);
                            setErrors({});
                            try {
                              await apiFetch(`/admin/accounts/${account.id}/credential`, {
                                method: "DELETE",
                              });
                              setKeyPrefix(null);
                              setRemoving(false);
                            } catch (error) {
                              const e = toApiError(error);
                              setErrors({ credential: `${e.code}: ${e.message}` });
                            } finally {
                              setPending(false);
                            }
                          }}
                          className="h-[28px] rounded-md px-2 text-small text-error hover:bg-error-surface disabled:opacity-50"
                        >
                          {pending ? "Removing…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(false)}
                          disabled={pending}
                          className="h-[28px] rounded-md px-2 text-small text-secondary hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoving(true)}
                        className="h-[28px] rounded-md px-2 text-small text-error hover:bg-error-surface"
                      >
                        Remove
                      </button>
                    ))}
                </div>
              )}
              {errors.credential && (
                <p className="mt-2 text-body text-error" role="alert">
                  {errors.credential}
                </p>
              )}
            </div>
          )}
          {errors.form && (
            <p className="text-body text-error" role="alert">
              {errors.form}
            </p>
          )}
          <FormFooter
            submitLabel={edit ? "Save changes" : "Create account"}
            pending={pending}
            onCancel={onClose}
          />
        </form>
      )}
    </Drawer>
  );
}

export function DeleteAccountDrawer({
  open,
  onClose,
  account,
  onDeleted,
  error,
}: {
  open: boolean;
  onClose: () => void;
  account: Account | null;
  onDeleted: () => Promise<void>;
  error: unknown;
}) {
  return (
    <ConfirmDrawer
      open={open}
      onClose={onClose}
      title={`Delete ${account?.displayName ?? "account"}`}
      consequence="The account leaves every serving pool; the API answers 409 while model mappings still reference it."
      confirmLabel="Delete account"
      typedName={account?.displayName}
      error={error}
      onConfirm={onDeleted}
    />
  );
}
