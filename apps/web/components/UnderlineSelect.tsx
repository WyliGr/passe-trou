"use client";

// Dropdown on a quiet 1px border-bottom. Used bare in panel headers, and composed into the
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
    <span className="relative inline-flex items-center border-b border-border pb-[3px]">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-body text-foreground outline-none [&>option]:bg-neutral"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-[70%] text-[10px] text-secondary"
      >
        ▾
      </span>
    </span>
  );
}
