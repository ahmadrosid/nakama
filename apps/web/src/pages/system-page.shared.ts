import {
  BlocksIcon,
  Building2Icon,
  CircleGaugeIcon,
  DatabaseBackupIcon,
  PlugIcon,
} from "lucide-react";

export const SYSTEM_TABS = [
  { id: "status" as const, label: "Status", icon: CircleGaugeIcon },
  { id: "organization" as const, label: "Organization", icon: Building2Icon },
  { id: "tools" as const, label: "Tools", icon: BlocksIcon },
  { id: "mcp" as const, label: "MCP", icon: PlugIcon },
  { id: "data" as const, label: "Data", icon: DatabaseBackupIcon },
] as const;

export type SystemTabId = (typeof SYSTEM_TABS)[number]["id"];

export function resolveSystemTab(value: string | null, isPlatformAdmin: boolean): SystemTabId {
  if (value === "status") {
    return "status";
  }

  if (value === "organization") {
    return "organization";
  }

  if (!isPlatformAdmin) {
    return "tools";
  }

  if (value === "mcp" || value === "data") {
    return value;
  }

  return "tools";
}

export function visibleSystemTabs(isPlatformAdmin: boolean) {
  if (isPlatformAdmin) {
    return SYSTEM_TABS;
  }

  return SYSTEM_TABS.filter(
    (item) => item.id === "status" || item.id === "organization" || item.id === "tools",
  );
}
