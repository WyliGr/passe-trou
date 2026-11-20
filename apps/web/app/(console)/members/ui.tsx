"use client";

// Presentational pieces of /members — also rendered with fixtures on /__dev__/states.

import { useState } from "react";
import type { AdminModel, KeyWithAllowlist, MemberWithKeys } from "@/lib/admin";
import { fmtDay } from "@/lib/format";
import { Pill } from "@/components/Pill";
import { SkeletonRows } from "@/components/Skeleton";
import { ExpandChevron } from "@/components/crud-forms";

/** Members table (42px rows): name, key count, created; expand → the member's keys. */
export function MembersTable({
  members,
  expanded,
  onToggle,
  onEditAllowlist,
  onDeleteKey,
}: {
  members: MemberWithKeys[];
  expanded: ReadonlySet<string>;
  onToggle: (memberId: string) => void;
  onEditAllowlist: (member: MemberWithKeys, key: KeyWithAllowlist) => void;
  onDeleteKey: (member: MemberWithKeys, key: KeyWithAllowlist) => void;
}) {
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="h-9 text-left text-small font-normal text-muted">
          <th scope="col" className="pr-4 font-normal">Name</th>
          <th scope="col" className="pr-4 text-right font-normal">Keys</th>
          <th scope="col" className="w-36 text-right font-normal">Created</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <MemberRows
            key={m.id}
            member={m}
            open={expanded.has(m.id)}
            onToggle={() => onToggle(m.id)}
            onEditAllowlist={onEditAllowlist}
            onDeleteKey={onDeleteKey}
          />
        ))}
      </tbody>
    </table>
  );
}

function MemberRows({
  member,
  open,
  onToggle,
  onEditAllowlist,
  onDeleteKey,
}: {
  member: MemberWithKeys;
  open: boolean;
  onToggle: () => void;
  onEditAllowlist: (member: MemberWithKeys, key: KeyWithAllowlist) => void;
  onDeleteKey: (member: MemberWithKeys, key: KeyWithAllowlist) => void;
}) {
  return (
    <>
      <tr className="h-[var(--row-height)] border-t border-rule">
        <td className="pr-4">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex h-full w-full items-center gap-2 text-left"
          >
            <ExpandChevron open={open} />
            <span>{member.displayName}</span>
          </button>
        </td>
        <td className="pr-4 text-right font-mono tabular-nums">{member.keys.length}</td>
        <td className="text-right font-mono tabular-nums text-muted">{fmtDay(member.createdAt)}</td>
      </tr>
      {open && (
        <tr className="border-t border-rule">
          <td colSpan={3} className="p-0">
            <KeysSubtable
              member={member}
              onEditAllowlist={onEditAllowlist}
              onDeleteKey={onDeleteKey}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function KeysSubtable({
  member,
  onEditAllowlist,
  onDeleteKey,
}: {
  member: MemberWithKeys;
  onEditAllowlist: (member: MemberWithKeys, key: KeyWithAllowlist) => void;
  onDeleteKey: (member: MemberWithKeys, key: KeyWithAllowlist) => void;
}) {
  if (member.keys.length === 0) {
    return (
      <p className="flex h-[var(--row-height)] items-center pl-7 text-body text-muted">
        No keys yet — issue one so this member can call the proxy.
      </p>
    );
  }
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="h-9 text-left text-small font-normal text-muted">
          <th scope="col" className="pl-7 pr-4 font-normal">Prefix</th>
          <th scope="col" className="pr-4 font-normal">Label</th>
          <th scope="col" className="pr-4 font-normal">Allowed models</th>
          <th scope="col" className="w-36 pr-4 text-right font-normal">Created</th>
          <th scope="col" className="w-44 text-right font-normal">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {member.keys.map((k) => (
          <tr key={k.id} className="h-[var(--row-height)] border-t border-rule">
            <td className="pl-7 pr-4 font-mono tabular-nums text-muted">{k.keyPrefix}…</td>
            <td className="pr-4">
              {k.label}
              {!k.enabled && <span className="ml-2 text-muted">(disabled)</span>}
            </td>
            <td className="pr-4">
              {k.allowlist.length === 0 ? (
                <span className="text-muted">all models</span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  {k.allowlist.map((am) => (
                    <Pill key={am.id} variant="neutral">{am.displayName}</Pill>
                  ))}
                </span>
              )}
            </td>
            <td className="pr-4 text-right font-mono tabular-nums text-muted">
              {fmtDay(k.createdAt)}
            </td>
            <td className="text-right">
              <div className="flex items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={() => onEditAllowlist(member, k)}
                  className="text-text hover:underline"
                >
                  Edit allowlist
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteKey(member, k)}
                  className="text-negative hover:underline"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Model multi-checkbox list fed by GET /admin/models; empty selection = wildcard. */
export function ModelChecklist({
  models,
  selected,
  onChange,
}: {
  models: AdminModel[] | null;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (models === null) return <SkeletonRows rows={3} rowHeight="34px" />;
  if (models.length === 0) {
    return <p className="text-body text-muted">No models yet — create one on the models page.</p>;
  }
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="max-h-64 overflow-y-auto rounded-card border border-rule">
      {models.map((m) => (
        <label
          key={m.id}
          className="flex h-[34px] items-center gap-3 border-rule px-3 text-body [&:not(:first-child)]:border-t"
        >
          <input
            type="checkbox"
            checked={selected.has(m.id)}
            onChange={() => toggle(m.id)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>{m.displayName}</span>
          {!m.enabled && <span className="text-muted">(disabled)</span>}
        </label>
      ))}
    </div>
  );
}

/**
 * The plaintext key, shown exactly once after creation (mono block + copy).
 * Lives only in the drawer's component state — closing the drawer clears it.
 */
export function KeyTokenBlock({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex">
        <input
          readOnly
          value={token}
          aria-label="New API key"
          onFocus={(e) => e.target.select()}
          className="h-[38px] w-full rounded-l-card border border-control border-r-0 bg-surface px-3 font-mono text-body text-text outline-none"
        />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(token);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="h-[38px] flex-none rounded-r-card border border-control px-3 text-small text-text hover:border-muted"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-body">This is the only time this key is shown.</p>
    </div>
  );
}
