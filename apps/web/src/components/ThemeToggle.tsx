import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useTheme } from "@/context/theme-context";
import { isTheme, type Theme } from "@/lib/theme";

const THEME_OPTIONS: {
  id: Theme;
  label: string;
  icon: typeof SunIcon;
}[] = [
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
  { id: "system", label: "System", icon: MonitorIcon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const selected =
    THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[1];
  const SelectedIcon = selected.icon;

  return (
    <Select
      value={theme}
      onValueChange={(value) => {
        if (value != null && isTheme(value)) {
          setTheme(value);
        }
      }}
    >
      <SelectTrigger className="w-[8.25rem]" aria-label="Color theme">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <SelectedIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="truncate">{selected.label}</span>
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;

          return (
            <SelectItem key={option.id} value={option.id}>
              <span className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                {option.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
