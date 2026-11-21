// Error state inline in the block that failed: badge-error with the API code, the
// message verbatim in secondary, and a secondary Retry button.

import { ApiError } from "@/lib/api";
import { Pill } from "@/components/Pill";

export function ErrorBlock({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const e =
    error instanceof ApiError
      ? error
      : new ApiError("network", error instanceof Error ? error.message : "request failed", 0);
  return (
    <div className="flex min-h-[38px] flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-4 py-2">
      <Pill variant="error">{e.code}</Pill>
      <p className="text-body text-secondary">{e.message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-[28px] rounded-md bg-muted px-3 text-small text-foreground hover:bg-border"
        >
          Retry
        </button>
      )}
    </div>
  );
}
