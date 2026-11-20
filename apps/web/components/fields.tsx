// Form primitives per app-screens.md §8: label above the field (14/500, 8px gap), 38px inputs,
// hint in muted or the API error verbatim in the negative tone under the field.

const CONTROL =
  "h-[38px] w-full rounded-card border border-control bg-raised px-3 text-body text-text outline-none placeholder:text-muted focus:border-accent disabled:opacity-60";

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-text">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-body text-negative">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-small text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      className={CONTROL}
    />
  );
}

export function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      className={`${CONTROL} font-mono`}
    />
  );
}

export function SelectInput<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { id: T; label: string }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={CONTROL}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
