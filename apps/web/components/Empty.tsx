// Empty state (DESIGN.md): one secondary line, optionally a secondary button.
// No illustration.

export function Empty({
  sentence,
  action,
}: {
  sentence: React.ReactNode; // widened from string (W15) so trade nouns can be set in mono
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`flex min-h-[38px] items-center gap-4 rounded-lg border border-dashed border-border px-4 py-2 ${
        action ? "justify-between" : "justify-center"
      }`}
    >      <p className="text-body text-secondary">{sentence}</p>
      {action}
    </div>
  );
}
