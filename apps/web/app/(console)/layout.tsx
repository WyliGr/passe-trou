// Shell for every console route: auth guard, icon rail, canvas (--pad outer, bottom-bar clearance on phone).

import { AuthGuard } from "@/components/AuthGuard";
import { Rail } from "@/components/Rail";

export default function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard>
      <Rail />
      <main className="ml-14 min-h-screen p-[var(--pad)] max-md:ml-0 max-md:px-5 max-md:py-6 max-md:pb-24">
        {children}
      </main>
    </AuthGuard>
  );
}
