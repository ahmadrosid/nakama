import {
  BlocksIcon,
  Building2Icon,
  CircleGaugeIcon,
  PlugIcon,
} from "lucide-react";

export const SYSTEM_TABS = [
  { icon: CircleGaugeIcon, id: "status" as const, label: "Status" },
  { icon: Building2Icon, id: "organization" as const, label: "Organization" },
  { icon: BlocksIcon, id: "tools" as const, label: "Tools" },
  { icon: PlugIcon, id: "mcp" as const, label: "MCP" },
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
