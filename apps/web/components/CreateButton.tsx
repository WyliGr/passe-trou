"use client";

// The one primary creation control per page: outlined 34px, never filled, selection-mark style —
// the 1px accent line exactly as wide as the label (DESIGN.md "the move").

export function CreateButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[var(--control-height)] rounded-control border border-control px-4 text-sm text-text hover:border-muted"
    >
      <span className="relative inline-block pb-[3px]">
        {label}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-px bg-accent"
        />
      </span>
    </button>
  );
}
