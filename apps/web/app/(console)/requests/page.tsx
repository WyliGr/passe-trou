"use client";

// Requests — which requests just happened, and why did the slow/failed ones fail?
// Filter row (staged, applied on Apply) · Live toggle (SSE prepend, filtered
// client-side, scroll preserved, 300-row cap) · 42px mono table · click row →
// detail drawer · "Load earlier" cursor pagination.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { PageTitle } from "@/components/PageTitle";
import { RequestDrawer } from "@/components/RequestDrawer";
import { SkeletonRows } from "@/components/Skeleton";
import { Table } from "@/components/Table";
import { requestColumns } from "@/components/requestColumns";
import { apiFetch } from "@/lib/api";
import { connectFeed, type FeedState } from "@/lib/feed";
import type { Column } from "@/components/Table";
import {
  DEFAULT_FILTERS,
  feedRowMatches,
  filtersQuery,
  type FeedRow,
  type Member,
  type RequestFilters,
  type RequestRow,
  type RequestsPage,
} from "@/lib/requests";

const PAGE_SIZE = 100;
const ROW_CAP = 300;

type TableState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ok" };

/** Relation labels the live feed omits — resolved against ids already seen. */
interface LabelCache {
  keys: Map<string, NonNullable<RequestRow["key"]>>;
  members: Map<string, NonNullable<RequestRow["member"]>>;
  accounts: Map<string, NonNullable<RequestRow["account"]>>;
  models: Map<string, NonNullable<RequestRow["model"]>>;
}

function feedToRow(f: FeedRow, cache: LabelCache): RequestRow {
  return {
    id: f.id,
    ts: f.ts,
    requestedModel: f.requestedModel,
    upstreamModel: f.upstreamModel,
    wireFormat: f.wireFormat,
    stream: f.stream,
    status: f.status === "error" || f.status === "aborted" ? f.status : "ok",
    httpStatus: f.httpStatus,
    errorCode: null,
    latencyMs: f.latencyMs,
    ttftMs: f.ttftMs,
    promptTokens: f.promptTokens,
    completionTokens: f.completionTokens,
    reasoningTokens: null,
    cachedTokens: null,
    toolCallCount: null,
    finishReason: null,
    costUsd: f.costUsd,
    clientName: null,
    key: f.keyId ? (cache.keys.get(f.keyId) ?? null) : null,
    member: f.memberId ? (cache.members.get(f.memberId) ?? null) : null,
    account: f.accountId ? (cache.accounts.get(f.accountId) ?? null) : null,
    model: f.modelId ? (cache.models.get(f.modelId) ?? null) : null,
  };
}

/** 28px outlined compound filter control: « Label · value » as one pill. */
function FilterPill({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[28px] items-center divide-x divide-control rounded-control border border-control text-small">
      <span className="px-3 text-muted">{label}</span>
      <div className="flex h-full items-center px-2">{children}</div>
    </div>
  );
}

const selectClass =
  "h-full appearance-none bg-transparent pr-4 text-text outline-none [&>option]:bg-raised";
const selectChevron = <span className="pointer-events-none -ml-3 text-muted">▾</span>;

export default function RequestsPage() {
  const [draft, setDraft] = useState<RequestFilters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<RequestFilters>(DEFAULT_FILTERS);
  const [table, setTable] = useState<TableState>({ status: "loading" });
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [live, setLive] = useState(false);
  const [feedState, setFeedState] = useState<FeedState>("connecting");
  const [drawerRow, setDrawerRow] = useState<RequestRow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const labelCache = useRef<LabelCache>({
    keys: new Map(),
    members: new Map(),
    accounts: new Map(),
    models: new Map(),
  });
  const prependAdjust = useRef<number | null>(null);

  // Relative ts freshness.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rememberLabels = useCallback((pageRows: RequestRow[]) => {
    const c = labelCache.current;
    for (const r of pageRows) {
      if (r.key) c.keys.set(r.key.id, r.key);
      if (r.member) c.members.set(r.member.id, r.member);
      if (r.account) c.accounts.set(r.account.id, r.account);
      if (r.model) c.models.set(r.model.id, r.model);
    }
  }, []);

  const load = useCallback(
    async (f: RequestFilters) => {
      setTable({ status: "loading" });
      try {
        const page = await apiFetch<RequestsPage>(
          `/admin/requests?limit=${PAGE_SIZE}${filtersQuery(f) ? `&${filtersQuery(f).slice(1)}` : ""}`,
        );
        rememberLabels(page.rows);
        setRows(page.rows);
        setNextCursor(page.nextCursor);
        setTable({ status: "ok" });
      } catch (error) {
        setTable({ status: "error", error });
      }
    },
    [rememberLabels],
  );

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  // Member labels for the filter control.
  useEffect(() => {
    apiFetch<Member[]>("/admin/members")
      .then((list) => {
        setMembers(list);
        const c = labelCache.current;
        for (const m of list) c.members.set(m.id, { id: m.id, name: m.displayName });
      })
      .catch(() => setMembers([]));
  }, []);

  // Live feed: prepend matching rows, cap the DOM, hold scroll position.
  useEffect(() => {
    if (!live) return;
    const feed = connectFeed({
      onState: setFeedState,
      onRequest: (row) => {
        if (!feedRowMatches(row, applied)) return;
        prependAdjust.current = document.documentElement.scrollHeight;
        setFreshIds((prev) => new Set(prev).add(row.id));
        setRows((prev) =>
          [feedToRow(row, labelCache.current), ...prev.filter((r) => r.id !== row.id)].slice(
            0,
            ROW_CAP,
          ),
        );
      },
    });
    return () => feed.close();
  }, [live, applied]);

  // After a prepend, keep the viewport on the rows the user was reading.
  useLayoutEffect(() => {
    if (prependAdjust.current === null) return;
    const prev = prependAdjust.current;
    prependAdjust.current = null;
    if (window.scrollY > 0) {
      window.scrollBy(0, document.documentElement.scrollHeight - prev);
    }
  });

  const loadEarlier = useCallback(async () => {
    if (!nextCursor || paging) return;
    setPaging(true);
    try {
      const page = await apiFetch<RequestsPage>(
        `/admin/requests?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}${
          filtersQuery(applied) ? `&${filtersQuery(applied).slice(1)}` : ""
        }`,
      );
      rememberLabels(page.rows);
      const known = new Set(rows.map((r) => r.id));
      setRows((prev) => [...prev, ...page.rows.filter((r) => !known.has(r.id))].slice(0, ROW_CAP));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setTable({ status: "error", error });
    } finally {
      setPaging(false);
    }
  }, [nextCursor, paging, applied, rows, rememberLabels]);

  const columns = useMemo<Column<RequestRow>[]>(
    () => requestColumns({ account: true, wire: true, tokens: true, now: nowMs }),
    [nowMs],
  );

  const filtersActive =
    applied.status !== "all" ||
    applied.memberId !== "" ||
    applied.minLatencyMs !== null ||
    applied.streamedOnly;

  const filterSummary = useMemo(() => {
    if (!filtersActive) return null;
    const parts: string[] = [];
    if (applied.status !== "all") parts.push(applied.status);
    if (applied.memberId) {
      parts.push(`member ${members.find((m) => m.id === applied.memberId)?.displayName ?? applied.memberId}`);
    }
    if (applied.minLatencyMs !== null) parts.push(`≥${applied.minLatencyMs}ms`);
    if (applied.streamedOnly) parts.push("streamed only");
    return `${parts.join(", ")} — ${rows.length} row${rows.length === 1 ? "" : "s"}`;
  }, [filtersActive, applied, members, rows.length]);

  const applyDraft = () => {
    setApplied({ ...draft });
    setFreshIds(new Set());
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Requests"
        {...(filterSummary ? { finding: filterSummary } : {})}
        actions={
          <div className="flex items-center gap-3">
            {live && feedState !== "live" && (
              <span className="text-small text-muted">
                {feedState === "connecting" ? "connecting…" : "reconnecting…"}
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={live}
              onClick={() => setLive((v) => !v)}
              className={`relative flex h-[var(--control-height)] items-center text-body ${
                live ? "text-text" : "text-muted hover:text-text"
              }`}
            >
              Live
              {live && (
                <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-px bg-accent" />
              )}
            </button>
          </div>
        }
      />

      {/* Filter row: staged until Apply, then the query refetches. */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill label="Status">
          <select
            aria-label="Status filter"
            className={selectClass}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as RequestFilters["status"] })}
          >
            <option value="all">all</option>
            <option value="ok">ok</option>
            <option value="error">error</option>
            <option value="aborted">aborted</option>
          </select>
          {selectChevron}
        </FilterPill>
        <FilterPill label="Member">
          <select
            aria-label="Member filter"
            className={selectClass}
            value={draft.memberId}
            onChange={(e) => setDraft({ ...draft, memberId: e.target.value })}
          >
            <option value="">all</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          {selectChevron}
        </FilterPill>
        <FilterPill label="min latency">
          <input
            aria-label="Minimum latency in milliseconds"
            type="number"
            min={0}
            step={50}
            placeholder="—"
            className="w-16 bg-transparent font-mono text-text outline-none placeholder:text-muted"
            value={draft.minLatencyMs ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                minLatencyMs: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))),
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") applyDraft();
            }}
          />
          <span className="text-muted">ms</span>
        </FilterPill>
        <button
          type="button"
          role="switch"
          aria-checked={draft.streamedOnly}
          onClick={() => setDraft({ ...draft, streamedOnly: !draft.streamedOnly })}
          className={`relative flex h-[28px] items-center rounded-control border border-control px-3 text-small ${
            draft.streamedOnly ? "text-text" : "text-muted hover:text-text"
          }`}
        >
          streamed only
          {draft.streamedOnly && (
            <span aria-hidden="true" className="absolute inset-x-3 -bottom-px h-px bg-accent" />
          )}
        </button>
        <button
          type="button"
          onClick={applyDraft}
          className="h-[28px] rounded-control border border-control px-3 text-small text-text hover:border-muted"
        >
          Apply
        </button>
      </div>

      <section aria-label="Request log" className="rounded-card bg-surface p-6 pt-4">
        {table.status === "error" ? (
          <ErrorBlock error={table.error} onRetry={() => load(applied)} />
        ) : table.status === "loading" ? (
          <SkeletonRows rows={8} rowHeight="42px" />
        ) : rows.length === 0 ? (
          <Empty sentence="No requests match — widen the filters or send traffic to the proxy." />
        ) : (
          <>
            <Table
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={setDrawerRow}
              rowClassName={(r) => (freshIds.has(r.id) ? "row-in" : "")}
            />
            <div className="mt-4 flex justify-center">
              {nextCursor ? (
                <button
                  type="button"
                  onClick={() => void loadEarlier()}
                  disabled={paging}
                  className="h-[28px] rounded-control border border-control px-3 text-small text-text hover:border-muted disabled:text-muted"
                >
                  {paging ? "Loading…" : "Load earlier"}
                </button>
              ) : rows.length > 0 ? (
                <p className="text-small text-muted">{"that's everything"}</p>
              ) : null}
            </div>
          </>
        )}
      </section>

      <RequestDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />
    </div>
  );
}
