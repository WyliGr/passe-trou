"use client";

// Segmented range presets: underline tabs on a 1px rule, selection = 1px accent line as wide as the label.

export interface RangeOption {
  id: string;
  label: string;
}

export function RangeTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Range",
}: {
  options: readonly RangeOption[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-5 border-b border-rule">
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.id as T)}
            className={`relative flex h-[var(--control-height)] items-center text-body ${
              selected ? "text-text" : "text-muted hover:text-text"
            }`}
          >
            {opt.label}
            {selected && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-px bg-accent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
