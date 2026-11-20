// Page title row: 26px/600 title + 14px muted finding line, quiet actions at the right end.

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
        <h1 className="text-title font-semibold leading-8">{title}</h1>
        {finding && <p className="mt-1 text-sm text-muted">{finding}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
