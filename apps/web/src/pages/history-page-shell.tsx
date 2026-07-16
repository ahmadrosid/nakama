import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

export function HistoryPageShell({ children }: { children: React.ReactNode }) {
  return (
    <section className={cn(sectionClass, "overflow-hidden")}>
      <div className="grid min-h-[100vh] lg:grid-cols-[240px_minmax(0,1fr)]">{children}</div>
    </section>
  );
}
