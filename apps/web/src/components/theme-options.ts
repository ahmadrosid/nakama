import { ComputerIcon, MoonIcon, Sun01Icon } from "hugeicons-react";
import type { Theme } from "@/lib/theme";

export const THEME_OPTIONS: {
  id: Theme;
  label: string;
  icon: typeof Sun01Icon;
}[] = [
  { icon: Sun01Icon, id: "light", label: "Light" },
  { icon: MoonIcon, id: "dark", label: "Dark" },
  { icon: ComputerIcon, id: "system", label: "System" },
];
