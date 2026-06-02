import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { filterModelsByProvider } from "@/lib/models";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/context/app-context";
import { pathForPage, NAV_ITEM_ICONS, SETUP_PATH } from "@/lib/navigation";

const SettingsNavIcon = NAV_ITEM_ICONS.settings;

export function ConnectionBar() {
  const { health, models, loading, setModel } = useAppContext();
  const navigate = useNavigate();
  const providerConfigured = health?.providerConfigured === true;
  const filteredModels = filterModelsByProvider(models?.models ?? [], models?.provider);
  const status = loading ? "checking" : health?.ok ? "online" : "offline";
  const statusDotClass = {
    online: "bg-emerald-500",
    checking: "bg-muted-foreground/40",
    offline: "bg-red-500",
  } as const;
  const statusLabel = {
    online: "Online",
    checking: "Checking…",
    offline: "Offline",
  } as const;

  return (
    <div className="inline-flex items-center gap-2">
      <div
        role="group"
        aria-label="LLM connection"
        className="inline-flex h-9 items-center rounded-lg border border-border bg-muted/30"
      >
        <div
          className="inline-flex h-9 items-center gap-2 px-3 text-xs font-medium text-muted-foreground"
          aria-live="polite"
        >
          <span className={`size-2 shrink-0 rounded-full ${statusDotClass[status]}`} />
          {statusLabel[status]}
        </div>

        {providerConfigured ? (
          <>
            <BarDivider />
            <Select
              value={models?.currentModel ?? ""}
              disabled={!filteredModels.length}
              onValueChange={(value) => {
                if (value != null) {
                  void setModel(String(value));
                }
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Active model"
                className="h-9 min-w-36 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-transparent dark:hover:bg-muted/50"
              >
                <SelectValue placeholder="No model" />
              </SelectTrigger>
              <SelectContent align="end">
                {filteredModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <>
            <BarDivider />
            <button
              type="button"
              onClick={() => navigate(SETUP_PATH)}
              className="flex h-9 items-center rounded-none px-3 text-xs font-medium text-amber-900 transition hover:bg-amber-100/80 dark:text-amber-200 dark:hover:bg-amber-950/50"
            >
              No provider — configure
            </button>
          </>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="Settings"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate(pathForPage("settings"))}
            >
              <SettingsNavIcon strokeWidth={1.75} />
            </Button>
          }
        />
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}

function BarDivider() {
  return <span className="h-4 w-px shrink-0 bg-border" aria-hidden />;
}
