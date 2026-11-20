import { EventEmitter } from "node:events";

/**
 * Live feed of persisted request rows (M2-T3). Module-level singleton: the
 * capture hook publishes after each row insert, any number of dashboard SSE
 * connections subscribe. Metrics + ids only — never prompt/response content.
 */

export interface FeedRow {
  id: string;
  ts: Date;
  requestedModel: string;
  upstreamModel: string | null;
  wireFormat: string;
  stream: boolean;
  status: string;
  httpStatus: number;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  keyId: string | null;
  memberId: string | null;
  accountId: string | null;
  modelId: string | null;
}

export type FeedListener = (row: FeedRow) => void;

const EVENT = "request";

const emitter = new EventEmitter();
// Dashboard may open many tabs; default limit of 10 would warn.
emitter.setMaxListeners(0);

export const feedBus = {
  /** Fire-and-forget: a throwing subscriber is swallowed, later subscribers still run. */
  publish(row: FeedRow): void {
    for (const listener of emitter.listeners(EVENT) as FeedListener[]) {
      try {
        listener(row);
      } catch {
        // subscriber errors never reach the proxy hot path
      }
    }
  },
  subscribe(listener: FeedListener): void {
    emitter.on(EVENT, listener);
  },
  unsubscribe(listener: FeedListener): void {
    emitter.off(EVENT, listener);
  },
  /** Test/ops introspection: current SSE subscriber count. */
  listenerCount(): number {
    return emitter.listenerCount(EVENT);
  },
};
