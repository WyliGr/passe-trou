"use client";

// /models — what each logical model maps to, and whether it is reachable.
// Chevron expands a model into its serving pool; wire format is derived from the mappings'
// provider types (the API stores no per-model wire format).

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { modelReachable, modelWireFormat, type LogicalModel } from "@/lib/admin";
import { CreateButton } from "@/components/CreateButton";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { IconChevronRight } from "@/components/icons";
import { PageTitle } from "@/components/PageTitle";
import { Pill } from "@/components/Pill";
import { SkeletonRows } from "@/components/Skeleton";
import { DeleteModelDrawer, MapAccountDrawer, ModelDrawer } from "./drawers";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok"; models: LogicalModel[] };

type DrawerState =
  | { kind: "new" }
  | { kind: "edit"; model: LogicalModel }
  | { kind: "delete"; model: LogicalModel }
  | { kind: "map"; model: LogicalModel };

export default function ModelsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deletingMapping, setDeletingMapping] = useState<string | null>(null);
  const [mappingErrors, setMappingErrors] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setState((s) => (s.status === "ok" ? s : { status: "loading" }));
    try {
      setState({ status: "ok", models: await apiFetch<LogicalModel[]>("/admin/models") });
    } catch (error) {
      setState({ status: "error", error });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeMapping = async (model: LogicalModel, mappingId: string) => {
    setDeletingMapping(mappingId);
    try {
      await apiFetch(`/admin/mappings/${mappingId}`, { method: "DELETE" });
      setMappingErrors((m) => {
        const next = { ...m };
        delete next[model.id];
        return next;
      });
      void load();
    } catch (error) {
      setMappingErrors((m) => ({ ...m, [model.id]: error }));
    } finally {
      setDeletingMapping(null);
    }
  };

  const models = state.status === "ok" ? state.models : null;
  const unreachable = models?.filter((m) => modelReachable(m) === false && m.enabled).length ?? 0;
  const finding =
    models === null
      ? "Reading the model pool…"
      : models.length === 0
        ? "Nothing is callable yet."
        : `${models.length} logical model${models.length === 1 ? "" : "s"}${
            unreachable > 0 ? ` · ${unreachable} unreachable` : ""
          }`;

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Models"
        finding={finding}
        actions={<CreateButton label="New model" onClick={() => setDrawer({ kind: "new" })} />}
      />

      {state.status === "error" ? (
        <ErrorBlock error={state.error} onRetry={load} />
      ) : models === null ? (
        <section className="rounded-card bg-surface p-6">
          <SkeletonRows rows={4} />
        </section>
      ) : models.length === 0 ? (
        <Empty
          sentence={
            <>
              No logical models yet — create one, map it to an account, and it becomes callable as{" "}
              <code>/v1/chat/completions</code> {"model:"}
              <span className="font-mono">{'"<name>"'}</span>.
            </>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-card bg-surface p-6">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="h-9">
                <th scope="col" className="w-6 pr-2" aria-label="Expand" />
                <th scope="col" className="pr-4 text-left text-small font-normal text-muted">
                  Model
                </th>
                <th scope="col" className="pr-4 text-left text-small font-normal text-muted">
                  Wire format
                </th>
                <th
                  scope="col"
                  className="pr-4 text-right text-small font-normal text-muted"
                >
                  Mapped accounts
                </th>
                <th scope="col" className="w-28" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const openRow = expanded.has(m.id);
                return [
                  <tr
                    key={m.id}
                    onClick={() => toggle(m.id)}
                    className="group h-[var(--row-height)] cursor-pointer border-t border-rule"
                  >
                    <td className="pr-2">
                      <IconChevronRight
                        className={`text-muted transition-transform ${openRow ? "rotate-90" : ""}`}
                      />
                    </td>
                    <td className="pr-4">
                      <span className="text-text">{m.displayName}</span>
                      {!m.enabled ? (
                        <span className="ml-2 align-middle">
                          <Pill variant="neutral">disabled</Pill>
                        </span>
                      ) : (
                        !modelReachable(m) && (
                          <span className="ml-2 align-middle">
                            <Pill variant="warning">unreachable</Pill>
                          </span>
                        )
                      )}
                    </td>
                    <td className="pr-4 text-muted">{modelWireFormat(m)}</td>
                    <td className="pr-4 text-right font-mono tabular-nums">
                      {m.mappings.length}
                    </td>
                    <td className="text-right">
                      <span className="flex items-center justify-end gap-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawer({ kind: "edit", model: m });
                          }}
                          className="text-text hover:text-accent"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteError(null);
                            setDrawer({ kind: "delete", model: m });
                          }}
                          className="text-negative hover:bg-pill-negative-bg"
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>,
                  ...(openRow
                    ? [
                        <tr key={`${m.id}:mappings`} className="border-t border-rule">
                          <td />
                          <td colSpan={4} className="py-1">
                            {m.mappings.length === 0 ? (
                              <p className="py-2 text-body text-muted">
                                No accounts mapped — this model is not callable.
                              </p>
                            ) : (
                              m.mappings.map((x) => (
                                <div
                                  key={x.id}
                                  className="group/map flex h-9 items-center gap-3"
                                >
                                  <span className="min-w-0 flex-1 text-body">
                                    <span className="text-text">{x.accountName}</span>
                                    <span className="text-muted"> · {x.providerName}</span>
                                  </span>
                                  {!x.accountEnabled && (
                                    <Pill variant="warning">benched</Pill>
                                  )}
                                  <span className="font-mono text-body text-muted">
                                    {x.upstreamModel}
                                  </span>
                                  <span className="flex w-14 justify-end opacity-0 transition-opacity group-hover/map:opacity-100 group-focus-within/map:opacity-100">
                                    <button
                                      type="button"
                                      disabled={deletingMapping === x.id}
                                      onClick={() => void removeMapping(m, x.id)}
                                      className="text-negative hover:bg-pill-negative-bg disabled:opacity-50"
                                    >
                                      Delete
                                    </button>
                                  </span>
                                </div>
                              ))
                            )}
                            {mappingErrors[m.id] ? (
                              <div className="mt-2">
                                <ErrorBlock error={mappingErrors[m.id]} />
                              </div>
                            ) : null}
                            <div className="mt-1 border-t border-rule pt-2">
                              <button
                                type="button"
                                onClick={() => setDrawer({ kind: "map", model: m })}
                                className="h-[28px] rounded-control border border-control px-3 text-small text-text hover:border-muted"
                              >
                                Map account…
                              </button>
                            </div>
                          </td>
                        </tr>,
                      ]
                    : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModelDrawer
        open={drawer?.kind === "new" || drawer?.kind === "edit"}
        onClose={() => setDrawer(null)}
        model={drawer?.kind === "edit" ? drawer.model : null}
        onSaved={() => {
          setDrawer(null);
          void load();
        }}
      />
      <DeleteModelDrawer
        open={drawer?.kind === "delete"}
        onClose={() => setDrawer(null)}
        model={drawer?.kind === "delete" ? drawer.model : null}
        error={deleteError}
        onDeleted={async () => {
          if (drawer?.kind !== "delete") return;
          try {
            await apiFetch(`/admin/models/${drawer.model.id}`, { method: "DELETE" });
            setDeleteError(null);
            void load();
          } catch (error) {
            setDeleteError(error);
            throw error;
          }
        }}
      />
      <MapAccountDrawer
        open={drawer?.kind === "map"}
        onClose={() => setDrawer(null)}
        model={drawer?.kind === "map" ? drawer.model : null}
        onSaved={() => {
          setDrawer(null);
          void load();
        }}
      />
    </div>
  );
}
