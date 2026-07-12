import type { LucideIcon } from "lucide-react";
import {
  CircleFadingPlusIcon,
  CircleUserRoundIcon,
  CircleGaugeIcon,
  BrainIcon,
  KanbanIcon,
  ClockIcon,
  CogIcon,
  WorkflowIcon,
  CableIcon,
} from "lucide-react";

export type PageId =
  | "status"
  | "chat"
  | "history"
  | "profiles"
  | "soul"
  | "automations"
  | "tasks"
  | "integrations"
  | "settings";

export interface NavItem {
  id: PageId;
  label: string;
  description: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "chat",
    label: "Chat",
    items: [
      {
        id: "chat",
        label: "New chat",
        description: "New chat",
      },
      {
        id: "history",
        label: "Chats",
        description: "Browse and reopen saved chats",
      },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    items: [
      {
        id: "profiles",
        label: "Profiles",
        description: "Manage bot configs and tool allowlists",
      },
      {
        id: "automations",
        label: "Automations",
        description: "Draft workflows from natural language",
      },
      {
        id: "tasks",
        label: "Tasks",
        description: "Agent swarm kanban board",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        id: "status",
        label: "Status",
        description: "Server and automation worker health",
      },
      {
        id: "integrations",
        label: "Integrations",
        description: "Bridges, Composio, and coding agents",
      },
      {
        id: "soul",
        label: "System",
        description: "Identity stack files and registered agent tools",
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const SETTINGS_NAV_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  description: "Provider API key and model",
};

export const NAV_ITEM_ICONS: Record<PageId, LucideIcon> = {
  status: CircleGaugeIcon,
  chat: CircleFadingPlusIcon,
  history: ClockIcon,
  profiles: CircleUserRoundIcon,
  soul: BrainIcon,
  automations: WorkflowIcon,
  tasks: KanbanIcon,
  integrations: CableIcon,
  settings: CogIcon,
};

export const SETUP_PATH = "/setup";

export const PLATFORM_ADMIN_PAGE_IDS: ReadonlySet<PageId> = new Set(["profiles", "soul"]);

export function canAccessSystemPage(
  isPlatformAdmin: boolean,
  orgRole: string | undefined,
): boolean {
  return isPlatformAdmin || orgRole === "admin";
}

export function canAccessIntegrationsPage(orgRole: string | undefined): boolean {
  return orgRole === "admin" || orgRole === "member";
}

export function canUseToolPlayground(
  isPlatformAdmin: boolean,
  orgRole: string | undefined,
): boolean {
  return isPlatformAdmin || orgRole === "admin";
}

export function toolsTabPath(): string {
  return `${PAGE_PATHS.soul}?tab=tools`;
}

export function toolPlaygroundPath(toolId: string): string {
  return `${PAGE_PATHS.soul}/playground/${encodeURIComponent(toolId)}`;
}

export const PAGE_PATHS: Record<PageId, string> = {
  status: "/status",
  chat: "/chat",
  history: "/history",
  profiles: "/profiles",
  soul: "/system",
  automations: "/automations",
  tasks: "/tasks",
  integrations: "/integrations",
  settings: "/settings",
};

export function pathForPage(pageId: PageId): string {
  return PAGE_PATHS[pageId];
}

export function navHrefForPage(
  pageId: PageId,
  chatProfileId?: string | null,
): string {
  if (pageId === "chat") {
    const params = new URLSearchParams({ new: "1" });
    if (chatProfileId) {
      params.set("profile", chatProfileId);
    }
    return `${PAGE_PATHS.chat}?${params.toString()}`;
  }

  return pathForPage(pageId);
}

export function findNavItem(pageId: PageId): NavItem | undefined {
  if (pageId === "settings") {
    return SETTINGS_NAV_ITEM;
  }

  return NAV_ITEMS.find((item) => item.id === pageId);
}

export function pageIdFromPath(pathname: string): PageId | null {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) {
    return "chat";
  }

  if (pathname === PAGE_PATHS.soul || pathname.startsWith(`${PAGE_PATHS.soul}/`)) {
    return "soul";
  }

  for (const [pageId, path] of Object.entries(PAGE_PATHS) as [PageId, string][]) {
    if (pageId === "chat") {
      continue;
    }

    if (pathname === path) {
      return pageId;
    }
  }

  return null;
}
