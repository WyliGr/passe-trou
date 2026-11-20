"use client";

// Shared column definitions for the request tables (overview recent block and
// the /requests screen): ts relative mono, model, member · key prefix,
// account, wire format, status (ok = muted text, error = negative pill,
// aborted = warning pill), TTFT, latency, tokens in/out, cost — mono right-aligned.

import { Pill } from "@/components/Pill";
import type { Column } from "@/components/Table";
import type { RequestRow } from "@/lib/requests";
import { fmtCost, fmtInt, fmtMs, fmtRel } from "@/lib/format";

const dash = <span className="text-muted">–</span>;

export function StatusCell({ row }: { row: Pick<RequestRow, "status"> }) {
  if (row.status === "ok") return <span className="text-muted">ok</span>;
  if (row.status === "error") return <Pill variant="negative">error</Pill>;
  return <Pill variant="warning">aborted</Pill>;
}

export function memberKeyCell(row: Pick<RequestRow, "member" | "key">) {
  if (!row.member && !row.key) return dash;
  return (
    <>
      {row.member ? row.member.name : <span className="text-muted">–</span>}
      <span className="text-muted"> · </span>
      {row.key ? <span className="font-mono">{row.key.prefix}</span> : <span className="text-muted">–</span>}
    </>
  );
}

export interface RequestColumnOptions {
  account?: boolean;
  wire?: boolean;
  tokens?: boolean;
  now?: number;
}

/** Column set for a request table; toggles widen it for the /requests screen. */
export function requestColumns(opts: RequestColumnOptions = {}): Column<RequestRow>[] {
  const cols: Column<RequestRow>[] = [
    {
      key: "ts",
      header: "When",
      mono: true,
      render: (r) => (
        <span className="text-muted" title={r.ts}>
          {fmtRel(r.ts, opts.now)}
        </span>
      ),
    },
    { key: "requestedModel", header: "Model" },
    { key: "memberKey", header: "Member · key", render: memberKeyCell },
  ];
  if (opts.account) {
    cols.push({
      key: "account",
      header: "Account",
      render: (r) => (r.account ? r.account.displayName : dash),
    });
  }
  if (opts.wire) {
    cols.push({
      key: "wireFormat",
      header: "Wire",
      render: (r) => <span className="text-muted">{r.wireFormat}</span>,
    });
  }
  cols.push(
    { key: "status", header: "Status", render: (r) => <StatusCell row={r} /> },
    {
      key: "ttftMs",
      header: "TTFT",
      align: "right",
      render: (r) => (r.ttftMs === null ? dash : fmtMs(r.ttftMs)),
    },
    { key: "latencyMs", header: "Latency", align: "right", render: (r) => fmtMs(r.latencyMs) },
  );
  if (opts.tokens) {
    cols.push({
      key: "tokens",
      header: "Tokens",
      align: "right",
      render: (r) =>
        r.promptTokens === null && r.completionTokens === null
          ? dash
          : `${fmtInt(r.promptTokens ?? 0)}/${fmtInt(r.completionTokens ?? 0)}`,
    });
  }
  cols.push({
    key: "costUsd",
    header: "Cost",
    align: "right",
    render: (r) => (r.costUsd === null ? dash : <span className="text-muted">{fmtCost(r.costUsd)}</span>),
  });
  return cols;
}
