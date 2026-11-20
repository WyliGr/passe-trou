"use client";

// /providers — which subscriptions are healthy, benched, or tripping their breaker.
// One section per provider, its accounts in a 42px table; hover reveals the row actions.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtCost, fmtInt } from "@/lib/format";
import type { Account, Provider, TestResult } from "@/lib/admin";
import type { Overview } from "@/lib/overview";
import { CreateButton } from "@/components/CreateButton";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { PageTitle } from "@/components/PageTitle";
import { Pill, type PillVariant } from "@/components/Pill";
import { Skeleton, SkeletonRows } from "@/components/Skeleton";
import { Table, type Column } from "@/components/Table";
import {
  AccountDrawer,
  DeleteAccountDrawer,
  DeleteProviderDrawer,
  ProviderDrawer,
} from "./drawers";

type Board = {
  providers: Provider[];
  accounts: Record<string, Account[]>;
  overview: Overview | null; // null = today columns degrade to dashes
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok"; board: Board };

type DrawerState =
  | { kind: "provider-new" }
  | { kind: "provider-edit"; provider: Provider }
  | { kind: "provider-delete"; provider: Provider }
  | { kind: "account-new"; provider: Provider }
  | { kind: "account-edit"; provider: Provider; account: Account }
  | { kind: "account-delete"; account: Account };

type TestState =
  | { status: "running" }
  | { status: "done"; result: TestResult };

function statusPill(
  a: Account,
  cooling: boolean,
): { label: string; variant: PillVariant } {
  if (a.status === "benched") return { label: "benched", variant: "warning" };
  if (cooling) return { label: "cooling down", variant: "warning" };
  return { label: "active", variant: "neutral" };
}

function testTone(t: TestState): React.ReactNode {
  if (t.status === "running")
    return <span className="font-mono text-body text-muted">testing…</span>;
  const r = t.result;
  if (r.ok)
    return (
      <span className="font-mono text-body text-positive">
        + {typeof r.latencyMs === "number" ? `${fmtInt(r.latencyMs)} ms` : "ok"}
      </span>
    );
  return (
    <span className="font-mono text-body text-negative">
      – {typeof r.httpStatus === "number" ? `HTTP ${r.httpStatus}` : "unreachable"}
    </span>
  );
}

export default function ProvidersPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const load = useCallback(async () => {
    setState((s) => (s.status === "ok" ? s : { status: "loading" }));
    try {
      const providers = await apiFetch<Provider[]>("/admin/providers");
      const [accountLists, overview] = await Promise.all([
        Promise.all(
          providers.map((p) =>
            apiFetch<Account[]>(`/admin/providers/${p.id}/accounts`),
          ),
        ),
        apiFetch<Overview>("/admin/overview").catch(() => null),
      ]);
      const accounts: Record<string, Account[]> = {};
      providers.forEach((p, i) => {
        accounts[p.id] = accountLists[i] ?? [];
      });
      setState({ status: "ok", board: { providers, accounts, overview } });
    } catch (error) {
      setState({ status: "error", error });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const board = state.status === "ok" ? state.board : null;
  const todayByAccount = new Map(
    board?.overview?.accounts.map((a) => [a.id, a] as const) ?? [],
  );

  const runTest = async (accountId: string) => {
    setTests((t) => ({ ...t, [accountId]: { status: "running" } }));
    try {
      const result = await apiFetch<TestResult>(`/admin/accounts/${accountId}/test`, {
        method: "POST",
      });
      setTests((t) => ({ ...t, [accountId]: { status: "done", result } }));
    } catch {
      setTests((t) => ({
        ...t,
        [accountId]: { status: "done", result: { ok: false } },
      }));
    }
  };

  const finding = board
    ? (() => {
        const all = Object.values(board.accounts).flat();
        if (all.length === 0) return "No accounts yet.";
        const cooling = all.filter(
          (a) => a.status === "active" && todayByAccount.get(a.id)?.cooling,
        ).length;
        const benched = all.filter((a) => a.status === "benched").length;
        const active = all.length - cooling - benched;
        const parts = [`${active} account${active === 1 ? "" : "s"} active`];
        if (benched > 0) parts.push(`${benched} benched`);
        if (cooling > 0) parts.push(`${cooling} cooling down`);
        return parts.join(" · ");
      })()
    : "Reading the subscription board…";

  const accountColumns = (provider: Provider): Column<Account>[] => [
    {
      key: "displayName",
      header: "Account",
      render: (a) => <span className="text-text">{a.displayName}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (a) => {
        const s = statusPill(a, todayByAccount.get(a.id)?.cooling === true);
        return <Pill variant={s.variant}>{s.label}</Pill>;
      },
    },
    {
      key: "credential",
      header: "Credential",
      render: (a) =>
        a.keyPrefix ? (
          <span className="font-mono text-muted">{a.keyPrefix}…</span>
        ) : (
          <span className="text-warning">no credential</span>
        ),
    },
    {
      key: "todayRequests",
      header: "Requests today",
      align: "right",
      render: (a) => {
        const t = todayByAccount.get(a.id);
        return t ? fmtInt(t.todayRequests) : <span className="text-muted">–</span>;
      },
    },
    {
      key: "todayCostUsd",
      header: "Cost today",
      align: "right",
      render: (a) => {
        const t = todayByAccount.get(a.id);
        return t ? (
          <span className="text-muted">{fmtCost(t.todayCostUsd)}</span>
        ) : (
          <span className="text-muted">–</span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (a) => {
        const test = tests[a.id];
        return (
        <span className="flex items-center justify-end gap-3 font-sans text-body">
          {test ? testTone(test) : null}
          <span className="flex items-center gap-3 whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => void runTest(a.id)}
              disabled={tests[a.id]?.status === "running"}
              className="text-text hover:text-accent disabled:text-muted"
            >
              Test
            </button>
            <button
              type="button"
              onClick={() => setDrawer({ kind: "account-edit", provider, account: a })}
              className="text-text hover:text-accent"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDrawer({ kind: "account-delete", account: a });
              }}
              className="text-negative hover:bg-pill-negative-bg"
            >
              Delete
            </button>
          </span>
        </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Providers"
        finding={finding}
        actions={
          <CreateButton
            label="New provider"
            onClick={() => setDrawer({ kind: "provider-new" })}
          />
        }
      />

      {state.status === "error" ? (
        <ErrorBlock error={state.error} onRetry={load} />
      ) : state.status === "loading" ? (
        <>
          {[0, 1].map((i) => (
            <section key={i} className="rounded-card bg-surface p-6">
              <Skeleton className="mb-4 h-5 w-48" />
              <SkeletonRows rows={2} />
            </section>
          ))}
        </>
      ) : board === null ? null : board.providers.length === 0 ? (
        <Empty sentence="No providers yet — add one, point it at an upstream, then attach accounts with their keys." />
      ) : (
        board.providers.map((p) => {
          const accounts = board.accounts[p.id] ?? [];
          return (
            <section key={p.id} className="group/ph rounded-card bg-surface p-6">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-section font-normal text-muted">
                  {p.displayName}
                  <span className="ml-2 text-body">{p.type}</span>
                </h2>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-small text-muted">
                    {p.createdAt.slice(0, 10)}
                  </span>
                  <span className="flex items-center gap-3 text-body opacity-0 transition-opacity group-hover/ph:opacity-100 group-focus-within/ph:opacity-100">
                    <button
                      type="button"
                      onClick={() => setDrawer({ kind: "provider-edit", provider: p })}
                      className="text-text hover:text-accent"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDrawer({ kind: "provider-delete", provider: p });
                      }}
                      className="text-negative hover:bg-pill-negative-bg"
                    >
                      Delete
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDrawer({ kind: "account-new", provider: p })}
                    className="h-[28px] rounded-control border border-control px-3 text-small text-text hover:border-muted"
                  >
                    New account
                  </button>
                </div>
              </div>
              {accounts.length === 0 ? (
                <Empty sentence="No accounts on this provider yet — add one and store its subscription key." />
              ) : (
                <div className="overflow-x-auto">
                  <Table
                    columns={accountColumns(p)}
                    rows={accounts}
                    rowKey={(a) => a.id}
                    rowClassName="group"
                  />
                </div>
              )}
            </section>
          );
        })
      )}

      <ProviderDrawer
        open={drawer?.kind === "provider-new" || drawer?.kind === "provider-edit"}
        onClose={() => setDrawer(null)}
        provider={drawer?.kind === "provider-edit" ? drawer.provider : null}
        onSaved={() => {
          setDrawer(null);
          void load();
        }}
      />
      <DeleteProviderDrawer
        open={drawer?.kind === "provider-delete"}
        onClose={() => setDrawer(null)}
        provider={drawer?.kind === "provider-delete" ? drawer.provider : null}
        accountCount={
          drawer?.kind === "provider-delete"
            ? (board?.accounts[drawer.provider.id] ?? []).length
            : 0
        }
        error={deleteError}
        onDeleted={async () => {
          if (drawer?.kind !== "provider-delete") return;
          try {
            await apiFetch(`/admin/providers/${drawer.provider.id}`, { method: "DELETE" });
            setDeleteError(null);
            void load();
          } catch (error) {
            setDeleteError(error);
            throw error;
          }
        }}
      />
      {(drawer?.kind === "account-new" || drawer?.kind === "account-edit") && (
        <AccountDrawer
          open
          onClose={() => setDrawer(null)}
          provider={drawer.provider}
          account={drawer.kind === "account-edit" ? drawer.account : null}
          onSaved={() => {
            setDrawer(null);
            void load();
          }}
        />
      )}
      <DeleteAccountDrawer
        open={drawer?.kind === "account-delete"}
        onClose={() => setDrawer(null)}
        account={drawer?.kind === "account-delete" ? drawer.account : null}
        error={deleteError}
        onDeleted={async () => {
          if (drawer?.kind !== "account-delete") return;
          try {
            await apiFetch(`/admin/accounts/${drawer.account.id}`, { method: "DELETE" });
            setDeleteError(null);
            void load();
          } catch (error) {
            setDeleteError(error);
            throw error;
          }
        }}
      />
    </div>
  );
}
