// Error state inside the block that failed: the API's code + message verbatim and a Retry button.

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
    <div className="flex min-h-[38px] flex-wrap items-center gap-3 rounded-card border border-dashed border-rule px-4 py-2">
      <Pill variant="negative">{e.code}</Pill>
      <p className="text-body text-muted">{e.message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-[28px] rounded-control border border-control px-3 text-small text-text hover:border-muted"
        >
          Retry
        </button>
      )}
    </div>
  );
}
