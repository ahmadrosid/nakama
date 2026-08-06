import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { Theme } from "@/lib/theme";

export const THEME_OPTIONS: {
  id: Theme;
  label: string;
  icon: typeof SunIcon;
}[] = [
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
  { id: "system", label: "System", icon: MonitorIcon },
];
