import { cn } from "@nakama/ui/utils";
import { ComputerIcon, MoonIcon, Sun01Icon } from "hugeicons-react";
import { useTheme } from "@/context/use-theme";
import type { Theme } from "@/lib/theme";

const THEME_OPTIONS: {
  icon: typeof Sun01Icon;
  id: Theme;
  label: string;
}[] = [
  { icon: ComputerIcon, id: "system", label: "System" },
  { icon: Sun01Icon, id: "light", label: "Light" },
  { icon: MoonIcon, id: "dark", label: "Dark" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {THEME_OPTIONS.map((option) => {
        const selected = option.id === theme;
        const Icon = option.icon;

        return (
          <button
            aria-pressed={selected}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={option.id}
            onClick={() => setTheme(option.id)}
            type="button"
          >
            <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
