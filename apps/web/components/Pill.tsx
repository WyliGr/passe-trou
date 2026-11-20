// Status chip on the four pill token pairs (app-screens.md §7.6: 20px, 12px at 500, never squeezed).

export type PillVariant = "neutral" | "positive" | "negative" | "warning";

const TONES: Record<PillVariant, string> = {
  neutral: "bg-pill-neutral-bg text-pill-neutral-ink",
  positive: "bg-pill-positive-bg text-pill-positive-ink",
  negative: "bg-pill-negative-bg text-pill-negative-ink",
  warning: "bg-pill-warning-bg text-pill-warning-ink",
};

export function Pill({
  variant,
  children,
}: {
  variant: PillVariant;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-small font-medium ${TONES[variant]}`}
    >
      {children}
    </span>
  );
}
