// Page title row: h1 (24px/600, -0.02em) + optional secondary finding line, quiet
// actions at the right end. No greeting, no marketing subtitle.

export function PageTitle({
  title,
  finding,
  actions,
}: {
  title: string;
  finding?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="h1">{title}</h1>
        {finding && <p className="mt-1 text-small text-secondary">{finding}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
