// Account status dot (DESIGN.md): 8px full round, success/warning/error by health.
// cooldown_429 / quota_exhausted / low_balance / cooling → warning;
// down / auth_invalid / expired / unknown → error; healthy / active → success.

export type StatusTone = "success" | "warning" | "error";

export function accountTone(status: string, cooling = false): StatusTone {
  if (cooling) return "warning";
  if (status === "healthy" || status === "active") return "success";
  if (
    status === "cooldown" ||
    status === "cooldown_429" ||
    status === "quota_exhausted" ||
    status === "low_balance" ||
    status === "benched"
  )
    return "warning";
  return "error"; // down, auth_invalid, expired, unknown
}

const DOTS: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};

export function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 flex-none rounded-full ${DOTS[tone]}`}
    />
  );
}

/** Dot + label cell for account status columns. */
export function StatusCellDot({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone={tone} />
      <span className="text-secondary">{label}</span>
    </span>
  );
}
