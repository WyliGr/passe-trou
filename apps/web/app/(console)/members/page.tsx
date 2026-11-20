"use client";

// /members — who holds which keys, with what allowlist.
// Data: members → keys per member → allowlist per key (M1 has no flat key list; see lib/admin).

import { useCallback, useEffect, useState } from "react";
import {
  createMember,
  createMemberKey,
  deleteKey,
  listModels,
  loadMembersWithKeys,
  setKeyModels,
  type AdminModel,
  type KeyWithAllowlist,
  type Member,
  type MemberWithKeys,
} from "@/lib/admin";
import { Drawer } from "@/components/Drawer";
import { Empty } from "@/components/Empty";
import { ErrorBlock } from "@/components/ErrorBlock";
import { PageTitle } from "@/components/PageTitle";
import { SkeletonRows } from "@/components/Skeleton";
import {
  ConfirmDeleteDrawer,
  CreateButton,
  Field,
  btnCls,
  inputCls,
} from "@/components/crud-forms";
import { KeyTokenBlock, MembersTable, ModelChecklist } from "./ui";

export default function MembersPage() {
  const [members, setMembers] = useState<MemberWithKeys[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<AdminModel[] | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [allowTarget, setAllowTarget] = useState<{
    member: MemberWithKeys;
    key: KeyWithAllowlist;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    member: MemberWithKeys;
    key: KeyWithAllowlist;
  } | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setMembers(await loadMembersWithKeys());
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Models are only needed by the drawers — fetch lazily, once.
  const ensureModels = useCallback(() => {
    setModels((prev) => {
      if (prev === null) void listModels().then(setModels).catch(() => setModels([]));
      return prev;
    });
  }, []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const keyCount = members?.reduce((n, m) => n + m.keys.length, 0) ?? 0;
  const wildcardCount =
    members?.reduce((n, m) => n + m.keys.filter((k) => k.allowlist.length === 0).length, 0) ?? 0;
  const finding = members
    ? `${members.length} ${members.length === 1 ? "member" : "members"} · ` +
      `${keyCount} ${keyCount === 1 ? "key" : "keys"} issued` +
      (wildcardCount > 0
        ? ` · ${wildcardCount} ${wildcardCount === 1 ? "key" : "keys"} without allowlist`
        : "")
    : undefined;

  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <PageTitle
        title="Members"
        finding={finding}
        actions={<CreateButton onClick={() => { ensureModels(); setNewOpen(true); }}>New member</CreateButton>}
      />

      {error !== null ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : members === null ? (
        <SkeletonRows rows={3} />
      ) : members.length === 0 ? (
        <Empty sentence="No members yet — members hold the API keys people call the proxy with." />
      ) : (
        <MembersTable
          members={members}
          expanded={expanded}
          onToggle={toggle}
          onEditAllowlist={(member, key) => { ensureModels(); setAllowTarget({ member, key }); }}
          onDeleteKey={(member, key) => setDeleteTarget({ member, key })}
        />
      )}

      <NewMemberDrawer
        open={newOpen}
        models={models}
        onClose={() => setNewOpen(false)}
        onChanged={reload}
      />

      <AllowlistDrawer
        target={allowTarget}
        models={models}
        onClose={() => setAllowTarget(null)}
        onSaved={reload}
      />

      <ConfirmDeleteDrawer
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete key"
        objectName={deleteTarget?.key.label ?? ""}
        consequence={`Calls made with ${deleteTarget?.key.keyPrefix ?? ""}… get a 401 immediately.`}
        confirmLabel="Delete key"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteKey(deleteTarget.key.id);
          await reload();
        }}
      />
    </div>
  );
}

type NewStep =
  | { kind: "name" }
  | { kind: "key"; member: Member }
  | { kind: "token"; member: Member; token: string };

function NewMemberDrawer({
  open,
  models,
  onClose,
  onChanged,
}: {
  open: boolean;
  models: AdminModel[] | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [step, setStep] = useState<NewStep>({ kind: "name" });
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [allowlist, setAllowlist] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setStep({ kind: "name" });
      setName("");
      setLabel("");
      setAllowlist(new Set());
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Closing drops the draft and any shown token; nothing persists past this view.
  const close = () => {
    const changed = step.kind !== "name";
    onClose();
    if (changed) void onChanged();
  };

  const submitName = async () => {
    setBusy(true);
    setError(null);
    try {
      const member = await createMember(name.trim());
      setStep({ kind: "key", member });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const submitKey = async (member: Member) => {
    setBusy(true);
    setError(null);
    try {
      const created = await createMemberKey(member.id, label.trim());
      // Optional allowlist: empty stays the wildcard; non-empty is a full replace.
      if (allowlist.size > 0) await setKeyModels(created.id, [...allowlist]);
      setStep({ kind: "token", member, token: created.token });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={close} title="New member">
      {step.kind === "name" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); void submitName(); }}
        >
          <Field label="Name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </Field>
          {error !== null && <ErrorBlock error={error} />}
          <div className="flex justify-end">
            <button type="submit" className={btnCls} disabled={!name.trim() || busy}>
              {busy ? "Creating…" : "Create member"}
            </button>
          </div>
        </form>
      )}

      {step.kind === "key" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); void submitKey(step.member); }}
        >
          <p className="text-body text-muted">
            {step.member.displayName} created. Issue a key for them now, or close this drawer and
            do it later.
          </p>
          <Field label="Key label" hint="Names the caller in the requests feed.">
            <input
              className={inputCls}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
              autoComplete="off"
              placeholder="opencode-worker-3"
            />
          </Field>
          <Field label="Model allowlist (optional)">
            <ModelChecklist models={models} selected={allowlist} onChange={setAllowlist} />
            <p className="text-body text-muted">None selected = all models.</p>
          </Field>
          {error !== null && <ErrorBlock error={error} />}
          <div className="flex justify-end">
            <button type="submit" className={btnCls} disabled={!label.trim() || busy}>
              {busy ? "Issuing…" : "Issue key"}
            </button>
          </div>
        </form>
      )}

      {step.kind === "token" && <KeyTokenBlock token={step.token} />}
    </Drawer>
  );
}

function AllowlistDrawer({
  target,
  models,
  onClose,
  onSaved,
}: {
  target: { member: MemberWithKeys; key: KeyWithAllowlist } | null;
  models: AdminModel[] | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setSelected(new Set(target?.key.allowlist.map((m) => m.id) ?? []));
    setError(null);
    setBusy(false);
  }, [target]);

  const save = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await setKeyModels(target.key.id, [...selected]);
      onClose();
      await onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={target !== null} onClose={onClose} title="Edit allowlist">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        <p className="text-body text-muted">
          <span className="text-text">{target?.key.label}</span>
          {" · "}
          <span className="font-mono">{target?.key.keyPrefix}…</span>
        </p>
        <Field label="Allowed models">
          <ModelChecklist models={models} selected={selected} onChange={setSelected} />
          <p className="text-body text-muted">None selected = all models (wildcard).</p>
        </Field>
        {error !== null && <ErrorBlock error={error} />}
        <div className="flex justify-end">
          <button type="submit" className={btnCls} disabled={busy}>
            {busy ? "Saving…" : "Save allowlist"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
