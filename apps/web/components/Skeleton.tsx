// Loading state: flat --raised bars at the real size (no shimmer), labels and headers shown at once.

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded bg-raised ${className ?? ""}`} />;
}

/** A stack of skeleton row bars at the given pitch (default table rows). */
export function SkeletonRows({
  rows,
  rowHeight = "42px",
}: {
  rows: number;
  rowHeight?: string;
}) {
  return (
    <div className="w-full" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center border-rule [&:not(:first-child)]:border-t"
          style={{ height: rowHeight }}
        >
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
}
