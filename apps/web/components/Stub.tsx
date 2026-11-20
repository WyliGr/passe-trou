// Stub page for routes a later worker fills (W13+): real title, the screen's question as the
// finding line, and the honest empty frame.

import { Empty } from "@/components/Empty";
import { PageTitle } from "@/components/PageTitle";

export function Stub({
  title,
  finding,
  sentence,
}: {
  title: string;
  finding: string;
  sentence: string;
}) {
  return (
    <div className="flex flex-col" style={{ gap: "var(--gap)" }}>
      <PageTitle title={title} finding={finding} />
      <Empty sentence={sentence} />
    </div>
  );
}
