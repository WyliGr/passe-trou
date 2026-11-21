"use client";

// /pricing — what price each model is billed at, and where a rule applies.
// M1 prices are a bulk-replace table (PUT /admin/prices only): add/edit/delete all
// submit the full list, and the response replaces local state.

import { useCallback, useEffect, useState } from "react";
import {
  listModels,
  listPrices,
  listProviders,
  loadAccounts,
  priceToEntry,
  putPrices,
  unpricedModels,
  type Account,
  type AdminModel,
  type Price,
  type PriceEntry,
  type Provider,
} from "@/lib/admin";
import { Drawer } from "@/components/Drawer";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { PageTitle } from "@/components/PageTitle";
import { RangeTabs } from "@/components/RangeTabs";
import { SkeletonRows } from "@/components/Skeleton";
import {
  ConfirmDeleteDrawer,
  CreateButton,
  Field,
  btnCls,
  inputCls,
} from "@/components/crud-forms";
import { PricingTable } from "./ui";

interface PricingData {
  prices: Price[];
  providers: Provider[];
  accounts: Array<Account & { providerName: string }>;
  models: AdminModel[];
}

export default function PricingPage() {
  const [data, setData] = useState<PricingData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Price | "new" | null>(null);
  const [deleting, setDeleting] = useState<Price | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [prices, providers, models, accounts] = await Promise.all([
        listPrices(),
        listProviders(),
        listModels(),
        loadAccounts(),
      ]);
      setData({ prices, providers, models, accounts });
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const unpriced = data ? unpricedModels(data.models, data.prices) : [];
  const finding = data
    ? `${data.prices.length} price ${data.prices.length === 1 ? "rule" : "rules"}` +
      (unpriced.length > 0
        ? ` · ${unpriced.length} ${unpriced.length === 1 ? "model" : "models"} unpriced`
        : "")
    : undefined;

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <div>
        <PageTitle
          title="Pricing"
          finding={finding}
          actions={<CreateButton onClick={() => setEditing("new")}>New price rule</CreateButton>}
        />
        {unpriced.length > 0 && (
          <p className="mt-2 text-body text-secondary">
            Unpriced: {unpriced.map((m) => m.displayName).join(" · ")}
          </p>
        )}
      </div>

      {error !== null ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : data === null ? (
        <SkeletonRows rows={3} />
      ) : data.prices.length === 0 ? (
        <Empty sentence="No price rules yet — requests are metered, but cost stays unknown until a model has a price." />
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface p-6">
          <PricingTable
            prices={data.prices}
            providers={data.providers}
            accounts={data.accounts}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        </div>
      )}

      {data && (
        <PriceEditorDrawer
          target={editing}
          prices={data.prices}
          providers={data.providers}
          accounts={data.accounts}
          onClose={() => setEditing(null)}
          onSaved={(prices) => setData({ ...data, prices })}
        />
      )}

      <ConfirmDeleteDrawer
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete price rule"
        objectName={deleting?.modelMatcher ?? ""}
        consequence={`Prices are a bulk-replace table: the rule for ${deleting?.modelMatcher ?? ""} is dropped from the submitted list, and matching requests stop getting a cost.`}
        confirmLabel="Delete rule"
        onConfirm={async () => {
          if (!deleting || !data) return;
          const next = data.prices.filter((p) => p.id !== deleting.id).map(priceToEntry);
          const saved = await putPrices(next);
          setData({ ...data, prices: saved });
        }}
      />
    </div>
  );
}

function PriceEditorDrawer({
  target,
  prices,
  providers,
  accounts,
  onClose,
  onSaved,
}: {
  target: Price | "new" | null;
  prices: Price[];
  providers: Provider[];
  accounts: Array<Account & { providerName: string }>;
  onClose: () => void;
  onSaved: (prices: Price[]) => void;
}) {
  const editingExisting = target !== null && target !== "new";
  const [scope, setScope] = useState<"provider" | "account">("provider");
  const [providerId, setProviderId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [matcher, setMatcher] = useState("");
  const [priceIn, setPriceIn] = useState("");
  const [priceOut, setPriceOut] = useState("");
  const [priceCached, setPriceCached] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (target === null) return;
    const p = editingExisting ? target : null;
    setScope(p?.scope ?? "provider");
    setProviderId(p?.providerId ?? providers[0]?.id ?? "");
    setAccountId(p?.accountId ?? accounts[0]?.id ?? "");
    setMatcher(p?.modelMatcher ?? "");
    setPriceIn(p ? String(p.priceInput) : "");
    setPriceOut(p ? String(p.priceOutput) : "");
    setPriceCached(p?.priceCachedInput != null ? String(p.priceCachedInput) : "");
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const scopeReady =
    scope === "provider" ? providerId !== "" && providers.length > 0 : accountId !== "" && accounts.length > 0;

  const parsePrice = (v: string, name: string, optional: boolean): number | null => {
    if (optional && v.trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number ≥ 0`);
    return optional ? n : n;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const entry: PriceEntry = {
        ...(editingExisting ? { id: target.id } : {}),
        scope,
        providerId: scope === "provider" ? providerId : null,
        accountId: scope === "account" ? accountId : null,
        modelMatcher: matcher.trim(),
        priceInput: parsePrice(priceIn, "Input price", false) as number,
        priceOutput: parsePrice(priceOut, "Output price", false) as number,
        priceCachedInput: parsePrice(priceCached, "Cached input price", true),
      };
      if (!entry.modelMatcher) throw new Error("Model matcher is required");
      const next = editingExisting
        ? prices.map((p) => (p.id === target.id ? entry : priceToEntry(p)))
        : [...prices.map(priceToEntry), entry];
      onSaved(await putPrices(next));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const clientError = error instanceof Error && !("code" in error) ? error.message : null;

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={editingExisting ? "Edit price rule" : "New price rule"}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        <Field label="Scope">
          <RangeTabs
            ariaLabel="Scope"
            options={[
              { id: "provider", label: "Provider" },
              { id: "account", label: "Account" },
            ]}
            value={scope}
            onChange={setScope}
          />
        </Field>

        {scope === "provider" ? (
          <Field
            label="Provider"
            hint={providers.length === 0 ? "No providers yet — create one first." : undefined}
          >
            <select
              className={inputCls}
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field
            label="Account"
            hint={accounts.length === 0 ? "No accounts yet — create one first." : undefined}
          >
            <select
              className={inputCls}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName} · {a.providerName}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field
          label="Model matcher"
          hint="exact name or glob like gpt-*; account rules win over provider rules"
        >
          <input
            className={`${inputCls} font-mono`}
            value={matcher}
            onChange={(e) => setMatcher(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="gpt-*"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Input $/M tok">
            <input
              type="number"
              step="any"
              min="0"
              className={`${inputCls} font-mono tabular-nums`}
              value={priceIn}
              onChange={(e) => setPriceIn(e.target.value)}
              placeholder="0.14"
            />
          </Field>
          <Field label="Output $/M tok">
            <input
              type="number"
              step="any"
              min="0"
              className={`${inputCls} font-mono tabular-nums`}
              value={priceOut}
              onChange={(e) => setPriceOut(e.target.value)}
              placeholder="0.28"
            />
          </Field>
          <Field label="Cached $/M tok">
            <input
              type="number"
              step="any"
              min="0"
              className={`${inputCls} font-mono tabular-nums`}
              value={priceCached}
              onChange={(e) => setPriceCached(e.target.value)}
              placeholder="optional"
            />
          </Field>
        </div>

        {clientError && <p className="text-body text-error">{clientError}</p>}
        {error !== null && !clientError && <ErrorBlock error={error} />}

        <div className="flex justify-end">
          <button type="submit" className={btnCls} disabled={busy || !scopeReady}>
            {busy ? "Saving…" : "Save rule"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
