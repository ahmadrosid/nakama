import { Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAppContext } from "@/context/app-context";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { usePrefetchAppData } from "@/hooks/use-app-queries";
import { NAV_ITEMS, pageIdFromPath, SETTINGS_NAV_ITEM } from "@/lib/navigation";
import { filterModelsByProvider, formatProviderLabel } from "@/lib/models";

export function Layout() {
  const location = useLocation();
  const { navigateToPage } = useAppNavigation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { health, models, loading, error, refresh, setModel } = useAppContext();
  const prefetchAppData = usePrefetchAppData();
  const activeNav =
    page === "settings"
      ? SETTINGS_NAV_ITEM
      : NAV_ITEMS.find((item) => item.id === page);

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar">
        <div className="border-b border-border px-5 py-5.5">
          <div className="flex items-center gap-3">
            <img
              src="/tinyclaw.png"
              alt="TinyClaw"
              className="size-9 shrink-0 rounded-lg object-contain"
            />
            <div>
              <p className="type-brand">TinyClaw</p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 p-3">
          {NAV_ITEMS.map((item) => {
            const active = item.id === page;

            return (
              <button
                key={item.id}
                type="button"
                title={item.description}
                aria-current={active ? "page" : undefined}
                onClick={() => navigateToPage(item.id)}
                onMouseEnter={item.id === "automations" ? prefetchAppData : undefined}
                onFocus={item.id === "automations" ? prefetchAppData : undefined}
                data-active={active || undefined}
                className="sidebar-nav-link"
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3">
          <button
            type="button"
            title={SETTINGS_NAV_ITEM.description}
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => navigateToPage("settings")}
            onMouseEnter={prefetchAppData}
            onFocus={prefetchAppData}
            data-active={page === "settings" || undefined}
            className="sidebar-nav-link !w-auto shrink-0"
          >
            {SETTINGS_NAV_ITEM.label}
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {page !== "chat" && page !== "status" ? (
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
            <div>
              <h1 className="type-page-title">{activeNav?.label}</h1>
              <p className="type-body">{activeNav?.description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusPill
                label={loading ? "Checking…" : health?.ok ? "Online" : "Offline"}
                tone={health?.ok ? "ok" : "bad"}
              />

              {health?.providerConfigured ? (
                <>
                  <StatusPill
                    label={formatProviderLabel(models?.provider)}
                    tone="neutral"
                  />
                  <select
                    className="h-8 min-w-48 rounded-md border border-input bg-input px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={models?.currentModel ?? ""}
                    disabled={!models?.models.length}
                    onChange={(event) => void setModel(event.target.value)}
                  >
                    {!models?.currentModel ? <option value="">No model</option> : null}
                    {filterModelsByProvider(models?.models ?? [], models?.provider).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => navigateToPage("settings")}
                  className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
                >
                  No provider — configure
                </button>
              )}

              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                Refresh
              </Button>
            </div>
          </header>
        ) : null}

        {error ? (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
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
          <Outlet />
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
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      : tone === "bad"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted text-muted-foreground";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}>
      {label}
    </span>
  );
}
