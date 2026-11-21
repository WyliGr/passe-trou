"use client";

// Presentational pieces of /pricing — also rendered with fixtures on /__dev__/states.

import type { Account, Price, Provider } from "@/lib/admin";
import { fmtCost } from "@/lib/format";

/**
 * Scope label per the design: "provider CommandCode" / "account Main #1".
 * "global" is defensive only — the M1 prices schema has no scope-less row
 * (CONTRACT deviation logged in /root/passetrou-briefs/deviations-w16.log).
 */
export function scopeLabel(
  p: Price,
  providers: Provider[],
  accounts: Array<Account & { providerName: string }>,
): string {
  if (p.accountId) {
    const a = accounts.find((acc) => acc.id === p.accountId);
    return `account ${a?.displayName ?? `${p.accountId.slice(0, 8)}…`}`;
  }
  if (p.providerId) {
    const pr = providers.find((prov) => prov.id === p.providerId);
    return `provider ${pr?.displayName ?? `${p.providerId.slice(0, 8)}…`}`;
  }
  return "global";
}

/** Price rules table (42px rows): mono matcher, muted scope, right-aligned $/M tok figures. */
export function PricingTable({
  prices,
  providers,
  accounts,
  onEdit,
  onDelete,
}: {
  prices: Price[];
  providers: Provider[];
  accounts: Array<Account & { providerName: string }>;
  onEdit: (p: Price) => void;
  onDelete: (p: Price) => void;
}) {
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="h-9 text-left label text-secondary">
          <th scope="col" className="pr-4 font-normal">Matcher</th>
          <th scope="col" className="pr-4 font-normal">Scope</th>
          <th scope="col" className="pr-4 text-right font-normal">Input $/M tok</th>
          <th scope="col" className="pr-4 text-right font-normal">Output $/M tok</th>
          <th scope="col" className="pr-4 text-right font-normal">Cached input $/M tok</th>
          <th scope="col" className="w-32 text-right font-normal">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {prices.map((p) => (
          <tr key={p.id} className="h-[var(--row-height)] border-t border-border">
            <td className="pr-4 font-mono tabular-nums">{p.modelMatcher}</td>
            <td className="pr-4 text-secondary">{scopeLabel(p, providers, accounts)}</td>
            <td className="pr-4 text-right font-mono tabular-nums">{fmtCost(p.priceInput)}</td>
            <td className="pr-4 text-right font-mono tabular-nums">{fmtCost(p.priceOutput)}</td>
            <td className="pr-4 text-right font-mono tabular-nums">
              {p.priceCachedInput === null ? (
                <span className="text-secondary">–</span>
              ) : (
                fmtCost(p.priceCachedInput)
              )}
            </td>
            <td className="text-right">
              <div className="flex items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  className="text-foreground hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p)}
                  className="text-error hover:underline"
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
