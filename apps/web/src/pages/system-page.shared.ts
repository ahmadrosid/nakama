import { BlocksIcon, DatabaseBackupIcon, PlugIcon } from "lucide-react";

export const SYSTEM_TABS = [
  { id: "tools" as const, label: "Tools", icon: BlocksIcon },
  { id: "mcp" as const, label: "MCP", icon: PlugIcon },
  { id: "data" as const, label: "Data", icon: DatabaseBackupIcon },
] as const;

export type SystemTabId = (typeof SYSTEM_TABS)[number]["id"];

export function resolveSystemTab(value: string | null, isPlatformAdmin: boolean): SystemTabId {
  if (!isPlatformAdmin) {
    return "tools";
  }

  if (value === "mcp" || value === "data") {
    return value;
  }

  return "tools";
}

export function visibleSystemTabs(isPlatformAdmin: boolean) {
  return isPlatformAdmin
    ? SYSTEM_TABS
    : SYSTEM_TABS.filter((item) => item.id === "tools");
}
