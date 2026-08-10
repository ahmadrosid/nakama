import {
  Building03Icon,
  DashboardSquare01Icon,
  LayoutGridIcon,
  Plug01Icon,
} from "hugeicons-react";

export const SYSTEM_TABS = [
  { icon: DashboardSquare01Icon, id: "status" as const, label: "Status" },
  { icon: Building03Icon, id: "organization" as const, label: "Organization" },
  { icon: LayoutGridIcon, id: "tools" as const, label: "Tools" },
  { icon: Plug01Icon, id: "mcp" as const, label: "MCP" },
] as const;

export type SystemTabId = (typeof SYSTEM_TABS)[number]["id"];

export function resolveSystemTab(
  value: string | null,
  isPlatformAdmin: boolean
): SystemTabId {
  if (value === "status") {
    return "status";
  }

  if (value === "organization") {
    return "organization";
  }

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

  return SYSTEM_TABS.filter(
    (item) =>
      item.id === "status" || item.id === "organization" || item.id === "tools"
  );
}
