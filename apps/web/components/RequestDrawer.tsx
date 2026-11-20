"use client";

// Request detail drawer (DESIGN.md §Requests): every stored field, sectioned,
// right 480px drawer. Fields absent from the live feed payload render as – .

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Pill } from "@/components/Pill";
import type { RequestRow } from "@/lib/requests";
import { fmtCost, fmtInt, fmtMs } from "@/lib/format";

const dash = <span className="text-muted">–</span>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-section font-normal text-muted">{title}</h3>
      <dl className="flex flex-col gap-1.5">{children}</dl>
    </section>
  );
}

function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-body">
      <dt className="flex-none text-muted">{label}</dt>
      <dd className={`break-all text-right ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="font-mono text-small">{id}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard blocked — id stays selectable
          }
        }}
        className="h-[22px] flex-none rounded-control border border-control px-2 text-small text-muted hover:border-muted hover:text-text"
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

export function RequestDrawer({
  row,
  onClose,
}: {
  row: RequestRow | null;
  onClose: () => void;
}) {
  const statusPill =
    row?.status === "error" ? (
      <Pill variant="negative">error</Pill>
    ) : row?.status === "aborted" ? (
      <Pill variant="warning">aborted</Pill>
    ) : (
      <span className="text-muted">ok</span>
    );

  return (
    <Drawer open={row !== null} onClose={onClose} title="Request detail">
      {row && (
        <>
          <Section title="Request">
            <Field label="id">
              <CopyId id={row.id} />
            </Field>
            <Field label="ts" mono>
              {row.ts}
            </Field>
            <Field label="requested model" mono>
              {row.requestedModel}
            </Field>
            <Field label="upstream model" mono>
              {row.upstreamModel ?? dash}
            </Field>
            <Field label="wire format">{row.wireFormat}</Field>
            <Field label="stream">{row.stream ? "yes" : "no"}</Field>
            <Field label="client">{row.clientName ?? dash}</Field>
          </Section>
          <Section title="Outcome">
            <Field label="status">{statusPill}</Field>
            <Field label="http status" mono>
              {row.httpStatus}
            </Field>
            <Field label="error code" mono>
              {row.errorCode ?? dash}
            </Field>
            <Field label="finish reason" mono>
              {row.finishReason ?? dash}
            </Field>
          </Section>
          <Section title="Timing">
            <Field label="latency" mono>
              {fmtMs(row.latencyMs)}
            </Field>
            <Field label="TTFT" mono>
              {row.ttftMs === null ? dash : fmtMs(row.ttftMs)}
            </Field>
          </Section>
          <Section title="Tokens">
            <Field label="prompt" mono>
              {row.promptTokens === null ? dash : fmtInt(row.promptTokens)}
            </Field>
            <Field label="completion" mono>
              {row.completionTokens === null ? dash : fmtInt(row.completionTokens)}
            </Field>
            <Field label="reasoning" mono>
              {row.reasoningTokens === null ? dash : fmtInt(row.reasoningTokens)}
            </Field>
            <Field label="cached" mono>
              {row.cachedTokens === null ? dash : fmtInt(row.cachedTokens)}
            </Field>
            <Field label="tool calls" mono>
              {row.toolCallCount === null ? dash : fmtInt(row.toolCallCount)}
            </Field>
          </Section>
          <Section title="Cost">
            <Field label="cost" mono>
              {row.costUsd === null ? dash : fmtCost(row.costUsd)}
            </Field>
          </Section>
          <Section title="Attribution">
            <Field label="member">{row.member ? row.member.name : dash}</Field>
            <Field label="key" mono>
              {row.key ? `${row.key.prefix} ${row.key.label}` : dash}
            </Field>
            <Field label="account">{row.account ? row.account.displayName : dash}</Field>
            <Field label="mapped model">{row.model ? row.model.name : dash}</Field>
          </Section>
        </>
      )}
    </Drawer>
  );
}
