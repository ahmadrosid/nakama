import { THEME_OPTIONS } from "@/components/theme-options";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useTheme } from "@/context/use-theme";
import { isTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const selected =
    THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[1];
  const SelectedIcon = selected.icon;

  return (
    <Select
      onValueChange={(value) => {
        if (value != null && isTheme(value)) {
          setTheme(value);
        }
      }}
      value={theme}
    >
      <SelectTrigger aria-label="Color theme" className="w-[8.25rem]">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <SelectedIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
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
                <Icon
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                  strokeWidth={1.75}
                />
                {option.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
