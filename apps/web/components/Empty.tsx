// Honest empty state: the block keeps its frame, one 13px muted sentence inside a dashed 1px box.

export function Empty({
  sentence,
  action,
}: {
  sentence: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-4 rounded-card border border-dashed border-rule px-4 py-2">
      <p className="text-body text-muted">{sentence}</p>
      {action}
    </div>
  );
}
