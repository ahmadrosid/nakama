import { cn } from "@nakama/ui/utils";
import { useTheme } from "@/context/use-theme";
import type { Theme } from "@/lib/theme";

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** A small window sketch in fixed colors, so each tile shows its theme in either mode. */
function ThemePreview({ dark }: { dark: boolean }) {
  return (
    <span
      className={cn(
        "flex h-full flex-1 flex-col gap-1.5 p-2.5",
        dark ? "bg-neutral-900" : "bg-white"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-3/5 rounded-full",
          dark ? "bg-neutral-700" : "bg-neutral-200"
        )}
      />
      <span
        className={cn(
          "h-1.5 w-4/5 rounded-full",
          dark ? "bg-neutral-800" : "bg-neutral-100"
        )}
      />
      <span
        className={cn(
          "mt-auto h-3.5 w-full rounded",
          dark ? "bg-neutral-800" : "bg-neutral-100"
        )}
      />
    </span>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-3 gap-3">
      {THEME_OPTIONS.map((option) => {
        const selected = option.id === theme;

        return (
          <button
            aria-pressed={selected}
            className="group flex min-w-0 flex-col gap-2 rounded-lg text-left outline-none"
            key={option.id}
            onClick={() => setTheme(option.id)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-20 overflow-hidden rounded-lg border transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
                selected
                  ? "border-2 border-primary"
                  : "border-border group-hover:border-foreground/30"
              )}
            >
              {option.id === "system" ? (
                <>
                  <ThemePreview dark={false} />
                  <ThemePreview dark />
                </>
              ) : (
                <ThemePreview dark={option.id === "dark"} />
              )}
            </span>
            <span
              className={cn(
                "text-sm",
                selected
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
