import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { Theme } from "@/lib/theme";

export const THEME_OPTIONS: {
  id: Theme;
  label: string;
  icon: typeof SunIcon;
}[] = [
  { icon: SunIcon, id: "light", label: "Light" },
  { icon: MoonIcon, id: "dark", label: "Dark" },
  { icon: MonitorIcon, id: "system", label: "System" },
];
