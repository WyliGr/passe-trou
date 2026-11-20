import { ApiError } from "../app.ts";
import type { Db } from "../db.ts";
import type {
  Account,
  Model,
  ModelAccount,
  Provider,
  ProviderKind,
} from "../generated/prisma/client.ts";
import type { AuthedKey } from "./auth.ts";

export type { AuthedKey };

export type ResolvedMapping = ModelAccount & { account: Account & { provider: Provider } };

export interface ResolvedRequest {
  model: Model;
  mappings: ResolvedMapping[];
}

const EDGE_HINT: Record<ProviderKind, string> = {
  anthropic: "use /v1/messages for anthropic-backed models",
  openai: "use /v1/chat/completions for openai-backed models",
};

/** Enabled models this key may see: empty allowlist = wildcard (all enabled). */
async function availableModelsFor(db: Db, key: AuthedKey): Promise<string[]> {
  const allowlist = new Set(key.allowedModels.map((m) => m.modelId));
  const enabled = await db.model.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  return enabled.filter((m) => allowlist.size === 0 || allowlist.has(m.id)).map((m) => m.name);
}

/**
 * Resolve a client's requested logical model to its servable mappings.
 * Eligibility: mapping.enabled && account.enabled. Wire guard drops mappings
 * whose provider kind ≠ the edge's wire format (passthrough only, no
 * translation). Throws ApiError with the contract codes on every failure.
 */
export async function resolveRequest(
  db: Db,
  requestedModel: string,
  wireFormat: ProviderKind,
  key: AuthedKey,
): Promise<ResolvedRequest> {
  const model = await db.model.findUnique({
    where: { name: requestedModel },
    include: {
      mappings: {
        where: { enabled: true, account: { enabled: true } },
        include: { account: { include: { provider: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!model || !model.enabled) {
    throw new ApiError(404, "model_not_found", `unknown model: ${requestedModel}`, {
      availableModels: await availableModelsFor(db, key),
    });
  }

  const allowlist = new Set(key.allowedModels.map((m) => m.modelId));
  if (allowlist.size > 0 && !allowlist.has(model.id)) {
    throw new ApiError(403, "model_not_allowed", `model not allowed for this key: ${requestedModel}`);
  }

  if (model.mappings.length === 0) {
    throw new ApiError(503, "no_healthy_accounts", `no healthy accounts for model: ${requestedModel}`);
  }

  const mappings = model.mappings.filter((m) => m.account.provider.kind === wireFormat);
  if (mappings.length === 0) {
    const kind = model.mappings[0]!.account.provider.kind;
    throw new ApiError(400, "wrong_wire_format", `${requestedModel} is ${kind}-backed`, {
      hint: EDGE_HINT[kind],
    });
  }

  return { model, mappings };
}
