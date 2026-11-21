// Semantic badges (DESIGN.md): tinted surface + tinted text, rounded-sm — the only
// place success/warning/error/info colours appear.

export type PillVariant = "neutral" | "success" | "warning" | "error" | "info";

const TONES: Record<PillVariant, string> = {
  neutral: "bg-muted text-foreground",
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  error: "bg-error-surface text-error",
  info: "bg-info-surface text-info",
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
      className={`label inline-flex flex-none items-center whitespace-nowrap rounded-sm px-1.5 py-0.5 ${TONES[variant]}`}
    >
      {children}
    </span>
  );
}
