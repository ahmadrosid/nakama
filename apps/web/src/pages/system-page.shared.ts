import { LayoutGridIcon, Plug01Icon } from "hugeicons-react";

export const SYSTEM_TABS = [
  { icon: LayoutGridIcon, id: "tools" as const, label: "Tools" },
  { icon: Plug01Icon, id: "mcp" as const, label: "MCP" },
] as const;

export type SystemTabId = (typeof SYSTEM_TABS)[number]["id"];

export function resolveSystemTab(
  value: string | null,
  isPlatformAdmin: boolean
): SystemTabId {
  if (!isPlatformAdmin) {
    return "tools";
  }

  if (value === "mcp") {
    return value;
  }

  return "tools";
}

export function visibleSystemTabs(isPlatformAdmin: boolean) {
  if (isPlatformAdmin) {
    return SYSTEM_TABS;
  }

  return SYSTEM_TABS.filter((item) => item.id === "tools");
}
