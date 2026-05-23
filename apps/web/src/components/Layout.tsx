import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/context/app-context";
import { NAV_ITEMS, type PageId } from "@/lib/navigation";

interface LayoutProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}

export function Layout({ page, onNavigate, children }: LayoutProps) {
  const { health, models, loading, error, refresh, setModel } = useAppContext();
  const activeNav = NAV_ITEMS.find((item) => item.id === page);

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar">
        <div className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
              T
            </div>
            <div>
              <p className="font-semibold text-foreground">TinyClaw</p>
              <p className="text-xs text-muted-foreground">Web dashboard</p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const active = item.id === page;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={[
                  "w-full rounded-md px-3 py-2.5 text-left transition",
                  active
                    ? "bg-muted text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
              >
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border p-4 text-xs text-muted-foreground">
          Server must be running on port 4310.
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {page !== "chat" ? (
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">{activeNav?.label}</h1>
              <p className="text-sm text-muted-foreground">{activeNav?.description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusPill
                label={loading ? "Checking…" : health?.ok ? "Online" : "Offline"}
                tone={health?.ok ? "ok" : "bad"}
              />

              {health?.providerConfigured ? (
                <>
                  <StatusPill
                    label={models?.provider ?? "provider"}
                    tone="neutral"
                  />
                  <select
                    className="h-8 min-w-48 rounded-md border border-input bg-input px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={models?.currentModel ?? ""}
                    disabled={!models?.models.length}
                    onChange={(event) => void setModel(event.target.value)}
                  >
                    {!models?.currentModel ? <option value="">No model</option> : null}
                    {models?.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <StatusPill label="No provider" tone="warn" />
              )}

              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                Refresh
              </Button>
            </div>
          </header>
        ) : null}

        {error ? (
          <div className="shrink-0 border-b border-red-900/40 bg-red-950/30 px-6 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <main
          className={
            page === "chat"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto p-6"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "bad" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-200"
      : tone === "bad"
        ? "border-red-800/60 bg-red-950/40 text-red-200"
        : tone === "warn"
          ? "border-amber-800/60 bg-amber-950/40 text-amber-200"
          : "border-border bg-muted text-muted-foreground";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}>
      {label}
    </span>
  );
}
