import { getDb } from "../db.ts";

/**
 * Load balancer over a logical model's mappings: least-used-in-window with a
 * per-account circuit breaker. Pure in-memory state — no Hono, injectable
 * clock. Mappings carrying a disabled account/provider never reach this class
 * (excluded by resolveRequest upstream).
 *
 * Starts are counted per mapping in a trailing 60 s window; cooldowns and
 * strikes are tracked per account (a 429 rate-limits the upstream key, not
 * the mapping). mappingId → accountId bindings are learned on pick().
 */

export interface BalancerCandidate {
  id: string;
  accountId: string;
}

export type NowFn = () => number; // ms epoch
export type PersistFn = (accountId: string, until: Date) => void;

const WINDOW_MS = 60_000;
const BASE_COOLDOWN_SEC = 30;
const MAX_COOLDOWN_SEC = 1800;

export class Balancer {
  private readonly now: NowFn;
  private readonly persist: PersistFn | undefined;
  private readonly starts = new Map<string, number[]>();
  private readonly strikes = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>(); // accountId → until ms
  private readonly mappingAccount = new Map<string, string>();

  constructor(opts: { now?: NowFn; persist?: PersistFn } = {}) {
    this.now = opts.now ?? Date.now;
    this.persist = opts.persist;
  }

  /** Fewest starts in the trailing 60 s among non-cooling mappings; ties → first; null when all cool. */
  pick(candidates: BalancerCandidate[]): string | null {
    let best: { id: string; starts: number } | null = null;
    for (const c of candidates) {
      this.mappingAccount.set(c.id, c.accountId);
      if (this.isCooling(c.accountId)) continue;
      const n = this.windowStarts(c.id);
      if (!best || n < best.starts) best = { id: c.id, starts: n };
    }
    return best?.id ?? null;
  }

  recordStart(mappingId: string): void {
    this.pruned(mappingId).push(this.now());
  }

  /** Success signal: resets the serving account's trip strikes. */
  recordDone(mappingId: string): void {
    const accountId = this.mappingAccount.get(mappingId);
    if (accountId) this.strikes.set(accountId, 0);
  }

  /**
   * 429/5xx: cool the account for retryAfterSec when the upstream named one,
   * else exponential 30→60→… capped at 1800 s. Persisted fire-and-forget so
   * restarts keep cooldowns.
   */
  trip(accountId: string, opts: { retryAfterSec?: number } = {}): void {
    const strikes = this.strikes.get(accountId) ?? 0;
    const sec =
      opts.retryAfterSec ?? Math.min(BASE_COOLDOWN_SEC * 2 ** strikes, MAX_COOLDOWN_SEC);
    this.strikes.set(accountId, strikes + 1);
    const until = this.now() + sec * 1000;
    this.cooldowns.set(accountId, until);
    this.persist?.(accountId, new Date(until));
  }

  /** Restore a persisted Account.cooledDownUntil after restart; past/null are ignored. */
  hydrate(accountId: string, until: Date | null): void {
    if (!until) return;
    const ms = until.getTime();
    if (ms > this.now()) this.cooldowns.set(accountId, ms);
  }

  /** Seconds of cooldown left for the mapping's account; null when not cooling. */
  cooldownRemainingSec(mappingId: string): number | null {
    const accountId = this.mappingAccount.get(mappingId);
    if (!accountId) return null;
    const until = this.cooldowns.get(accountId);
    if (until === undefined) return null;
    const remaining = Math.ceil((until - this.now()) / 1000);
    if (remaining <= 0) {
      this.cooldowns.delete(accountId);
      return null;
    }
    return remaining;
  }

  private isCooling(accountId: string): boolean {
    const until = this.cooldowns.get(accountId);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.cooldowns.delete(accountId);
      return false;
    }
    return true;
  }

  private windowStarts(mappingId: string): number {
    return this.pruned(mappingId).length;
  }

  private pruned(mappingId: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const arr = (this.starts.get(mappingId) ?? []).filter((t) => t >= cutoff);
    this.starts.set(mappingId, arr);
    return arr;
  }
}

/**
 * Process-wide singleton; cooldowns persist to Account.cooledDownUntil
 * (fire-and-forget). After a restart the request path must `hydrate` from
 * those rows — resolveRequest already loads the account columns.
 */
export const balancer = new Balancer({
  persist: (accountId, until) => {
    void getDb()
      .account.update({ where: { id: accountId }, data: { cooledDownUntil: until } })
      .catch(() => {
        // fire-and-forget: DB outage must never break request routing
      });
  },
});
