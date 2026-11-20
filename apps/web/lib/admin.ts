"use client";

// W16 data layer for /members and /pricing. All calls through apiFetch; shapes mirrored
// from apps/api/src/admin/*.ts (route truth: API.md), which the web app proxies at /api/*.

import { apiFetch } from "@/lib/api";

// ---- shared core shapes (W15) ----

export type ProviderType = "openai-compatible" | "anthropic-compatible";

export interface Provider {
  id: string;
  displayName: string;
  type: ProviderType;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

export type AccountStatus = "active" | "benched";

export interface Account {
  id: string;
  providerId: string;
  displayName: string;
  status: AccountStatus;
  /** First 8 chars of the upstream key, or null when no credential is stored. */
  keyPrefix: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs?: number;
}

export interface Mapping {
  id: string;
  accountId: string;
  accountName: string;
  providerName: string;
  providerType: ProviderType;
  accountEnabled: boolean;
  upstreamModel: string;
}

export interface LogicalModel {
  id: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  mappings: Mapping[];
}

export const PROVIDER_TYPES: readonly { id: ProviderType; label: string }[] = [
  { id: "openai-compatible", label: "OpenAI-compatible" },
  { id: "anthropic-compatible", label: "Anthropic-compatible" },
];

/** One wire format for the pool, or "mixed" when a model spans both. */
export function modelWireFormat(m: LogicalModel): string {
  const kinds = new Set(m.mappings.map((x) => x.providerType));
  if (kinds.size === 0) return "–";
  if (kinds.size > 1) return "mixed";
  return [...kinds][0] ?? "–";
}

/** A model is callable when enabled and at least one mapped account is enabled. */
export function modelReachable(m: LogicalModel): boolean {
  return m.enabled && m.mappings.some((x) => x.accountEnabled);
}

// ---- members & keys shapes (W16) ----

export interface Member {
  id: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberKey {
  id: string;
  keyPrefix: string;
  label: string;
  enabled: boolean;
  createdAt: string;
}

/** Only the creation response ever carries `token` — show it once, never persist it. */
export interface CreatedKey extends MemberKey {
  token: string;
}

export interface AllowedModel {
  id: string;
  displayName: string;
}

export interface KeyWithAllowlist extends MemberKey {
  /** Empty = wildcard (every enabled model allowed), non-empty = exactly those models. */
  allowlist: AllowedModel[];
}

export interface MemberWithKeys extends Member {
  keys: KeyWithAllowlist[];
}

export interface ModelMapping {
  id: string;
  accountId: string;
  accountName: string;
  providerName: string;
  providerType: string;
  accountEnabled: boolean;
  upstreamModel: string;
}

export interface AdminModel {
  id: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  mappings: ModelMapping[];
}

export interface Price {
  id: string;
  scope: "provider" | "account";
  providerId: string | null;
  accountId: string | null;
  modelMatcher: string;
  priceInput: number;
  priceOutput: number;
  priceCachedInput: number | null;
  updatedAt: string;
}

/** Entry shape the bulk-replace PUT accepts (id present → update in place). */
export interface PriceEntry {
  id?: string;
  scope: "provider" | "account";
  providerId?: string | null;
  accountId?: string | null;
  modelMatcher: string;
  priceInput: number;
  priceOutput: number;
  priceCachedInput?: number | null;
}

// ---- members & keys ----

export const listMembers = () => apiFetch<Member[]>("/admin/members");

export const createMember = (displayName: string) =>
  apiFetch<Member>("/admin/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });

export const createMemberKey = (memberId: string, label: string) =>
  apiFetch<CreatedKey>(`/admin/members/${memberId}/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });

export const deleteKey = (keyId: string) =>
  apiFetch<null>(`/admin/keys/${keyId}`, { method: "DELETE" });

export const getKeyModels = (keyId: string) =>
  apiFetch<AllowedModel[]>(`/admin/keys/${keyId}/models`);

export const setKeyModels = (keyId: string, modelIds: string[]) =>
  apiFetch<AllowedModel[]>(`/admin/keys/${keyId}/models`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelIds }),
  });

/**
 * M1 has no flat key list: members → keys per member → allowlist per key.
 * Member/key counts stay small (people, bearers), so the fan-out is fine.
 */
export async function loadMembersWithKeys(): Promise<MemberWithKeys[]> {
  const members = await listMembers();
  return Promise.all(
    members.map(async (member) => {
      const keys = await apiFetch<MemberKey[]>(`/admin/members/${member.id}/keys`);
      const withAllowlists = await Promise.all(
        keys.map(async (key) => ({ ...key, allowlist: await getKeyModels(key.id) })),
      );
      return { ...member, keys: withAllowlists };
    }),
  );
}

// ---- models, providers, accounts ----

export const listModels = () => apiFetch<AdminModel[]>("/admin/models");

export const listProviders = () => apiFetch<Provider[]>("/admin/providers");

/** Accounts exist only nested under their provider in M1 — assemble the flat list here. */
export async function loadAccounts(): Promise<Array<Account & { providerName: string }>> {
  const providers = await listProviders();
  const nested = await Promise.all(
    providers.map(async (p) => {
      const accounts = await apiFetch<Account[]>(`/admin/providers/${p.id}/accounts`);
      return accounts.map((a) => ({ ...a, providerName: p.displayName }));
    }),
  );
  return nested.flat();
}

// ---- prices (bulk-replace table) ----

export const listPrices = () => apiFetch<Price[]>("/admin/prices");

/** The submitted list IS the new price table: rows missing from it are deleted. */
export const putPrices = (prices: PriceEntry[]) =>
  apiFetch<Price[]>("/admin/prices", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prices }),
  });

export const priceToEntry = (p: Price): PriceEntry => ({
  id: p.id,
  scope: p.scope,
  providerId: p.providerId,
  accountId: p.accountId,
  modelMatcher: p.modelMatcher,
  priceInput: p.priceInput,
  priceOutput: p.priceOutput,
  priceCachedInput: p.priceCachedInput,
});

/**
 * Mirrors the server matcher (apps/api/src/lib/cost.ts): exact name, or a single
 * trailing `*` = prefix match. The server resolves per request (account/provider
 * scoped); this client copy only derives the "models unpriced" hint below.
 */
export function matcherHits(matcher: string, upstreamModel: string): boolean {
  return matcher.endsWith("*")
    ? upstreamModel.startsWith(matcher.slice(0, -1))
    : matcher === upstreamModel;
}

/**
 * Logical models with no priced upstream mapping. Assumption (documented per the
 * worker brief): a model counts as priced when ANY of its mappings' upstreamModel
 * matches ANY rule's matcher — scope is ignored, because which account serves the
 * next request is runtime state the console cannot know. A rule can thus exist for
 * a model yet never fire for a given account; this line is a lint, not the bill.
 * Models with no mappings cannot be priced at capture time → counted unpriced.
 */
export function unpricedModels(models: AdminModel[], prices: Price[]): AdminModel[] {
  return models.filter(
    (m) =>
      m.mappings.length === 0 ||
      !m.mappings.some((mp) => prices.some((p) => matcherHits(p.modelMatcher, mp.upstreamModel))),
  );
}
