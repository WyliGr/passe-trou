// Honest empty state: the block keeps its frame, one 13px muted sentence inside a dashed 1px box.

export function Empty({
  sentence,
  action,
}: {
  sentence: React.ReactNode; // widened from string (W15) so trade nouns can be set in mono
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-4 rounded-card border border-dashed border-rule px-4 py-2">
      <p className="text-body text-muted">{sentence}</p>
      {action}
    </div>
  );
}
