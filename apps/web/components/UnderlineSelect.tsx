"use client";

// Dropdown marked by the style's 1px accent line exactly as wide as the current value
// (never a fill or a pill). Used bare in panel headers, and composed into the
// "Group by · x ▾" sentence control on Analytics.

export interface SelectOption {
  id: string;
  label: string;
}

export function UnderlineSelect<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SelectOption[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <span className="relative inline-flex items-center pb-[3px]">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-body text-text outline-none [&>option]:bg-ground"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-[70%] text-[10px] text-muted"
      >
        ▾
      </span>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-accent" />
    </span>
  );
}
