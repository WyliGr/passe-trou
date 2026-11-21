"use client";

// The one primary action per screen (DESIGN.md button-primary): blue fill, white text,
// rounded-md; hover primary-hover, pressed primary-strong. Everything else is secondary.

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
      className="h-[var(--control-height)] rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover active:bg-primary-strong"
    >
      {label}
    </button>
  );
}
