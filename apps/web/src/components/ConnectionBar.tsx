import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/context/app-context";
import { SETUP_PATH } from "@/lib/navigation";
import { filterModelsByProvider, formatProviderLabel } from "@/lib/models";
import { cn } from "@/lib/utils";

export function ConnectionBar() {
  const { health, models, loading, setModel } = useAppContext();
  const navigate = useNavigate();
  const providerConfigured = health?.providerConfigured === true;
  const filteredModels = filterModelsByProvider(models?.models ?? [], models?.provider);
  const statusActive = !loading && health?.ok === true;

  return (
    <div
      role="group"
      aria-label="LLM connection"
      className="inline-flex h-9 items-center rounded-lg border border-border bg-muted/30"
    >
      <ConnectionStatus
        active={statusActive}
        label={loading ? "Checking…" : health?.ok ? "Server online" : "Server offline"}
      />

      {providerConfigured ? (
        <>
          <BarDivider />
          <span className="flex h-9 items-center px-2 text-xs font-medium text-muted-foreground">
            {formatProviderLabel(models?.provider)}
          </span>
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
  );
}

function ConnectionStatus({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      className="inline-flex h-9 items-center gap-2 px-3 text-xs font-medium text-muted-foreground"
      aria-live="polite"
    >
      <span className="relative flex size-2 shrink-0">
        {active ? (
          <>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </>
        ) : (
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              label === "Checking…" ? "bg-muted-foreground/40" : "bg-red-500",
            )}
          />
        )}
      </span>
      <span className={active ? "text-emerald-800 dark:text-emerald-200" : undefined}>{label}</span>
    </div>
  );
}

function BarDivider() {
  return <span className="h-4 w-px shrink-0 bg-border" aria-hidden />;
}
