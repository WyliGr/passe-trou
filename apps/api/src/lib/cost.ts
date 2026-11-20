/**
 * Per-request cost from hand-set prices (USD per 1M tokens).
 * Pure function: the caller loads Price rows from the DB.
 */

export interface PriceLike {
  id: string;
  providerId: string | null;
  accountId: string | null;
  modelMatcher: string;
  priceInput: number;
  priceOutput: number;
  priceCachedInput: number | null;
}

export interface CostArgs {
  accountId: string;
  providerId: string;
  upstreamModel: string;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens?: number | null;
}

/** Exact match, or glob = single trailing `*` (prefix match). */
function matcherHits(matcher: string, upstreamModel: string): boolean {
  if (matcher.endsWith("*")) {
    return upstreamModel.startsWith(matcher.slice(0, -1));
  }
  return matcher === upstreamModel;
}

/**
 * Resolution precedence: account-exact > provider-exact > account-glob > provider-glob.
 * Returns null when no price matches or when any needed token count is null —
 * cost is never guessed.
 */
export function computeCost(args: CostArgs, prices: PriceLike[]): number | null {
  const { accountId, providerId, upstreamModel } = args;

  const tiers: Array<(p: PriceLike) => boolean> = [
    (p) => p.accountId === accountId && p.modelMatcher === upstreamModel,
    (p) => p.providerId === providerId && p.accountId === null && p.modelMatcher === upstreamModel,
    (p) => p.accountId === accountId && p.modelMatcher.endsWith("*") && matcherHits(p.modelMatcher, upstreamModel),
    (p) => p.providerId === providerId && p.accountId === null && matcherHits(p.modelMatcher, upstreamModel),
  ];

  let price: PriceLike | undefined;
  for (const tier of tiers) {
    price = prices.find((p) => tier(p));
    if (price) break;
  }
  if (!price) return null;

  if (args.promptTokens === null || args.completionTokens === null) return null;
  const cached = args.cachedTokens ?? 0;

  let inputUsd: number;
  if (cached > 0 && price.priceCachedInput !== null) {
    inputUsd =
      (cached / MILLION) * price.priceCachedInput +
      ((args.promptTokens - cached) / MILLION) * price.priceInput;
  } else {
    inputUsd = (args.promptTokens / MILLION) * price.priceInput;
  }
  return inputUsd + (args.completionTokens / MILLION) * price.priceOutput;
}

const MILLION = 1_000_000;
