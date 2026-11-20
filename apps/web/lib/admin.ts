// Wire shapes of the /admin/* CRUD routes (root API.md). Client-side only, via apiFetch.

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
