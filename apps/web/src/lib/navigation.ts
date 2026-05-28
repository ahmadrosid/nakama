import type { LucideIcon } from "lucide-react";
import {
  CircleGaugeIcon,
  GemIcon,
  KanbanIcon,
  MessageCircleIcon,
  ArchiveIcon,
  Settings2Icon,
  UserRoundIcon,
  WorkflowIcon,
  WrenchIcon,
} from "lucide-react";

export type PageId =
  | "status"
  | "chat"
  | "history"
  | "profiles"
  | "tools"
  | "soul"
  | "automations"
  | "tasks"
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
        label: "Chat",
        description: "Talk to the agent with streaming replies",
      },
      {
        id: "history",
        label: "History",
        description: "Browse and reopen saved chat sessions",
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
        id: "soul",
        label: "Soul",
        description: "Identity stack files and templates",
      },
      {
        id: "tools",
        label: "Tools",
        description: "Browse tools created by the agent",
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
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const SETTINGS_NAV_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  description: "Provider API key and model",
};

export const NAV_ITEM_ICONS: Record<PageId, LucideIcon> = {
  status: CircleGaugeIcon,
  chat: MessageCircleIcon,
  history: ArchiveIcon,
  profiles: UserRoundIcon,
  tools: WrenchIcon,
  soul: GemIcon,
  automations: WorkflowIcon,
  tasks: KanbanIcon,
  settings: Settings2Icon,
};

export const PAGE_PATHS: Record<PageId, string> = {
  status: "/status",
  chat: "/chat",
  history: "/history",
  profiles: "/profiles",
  tools: "/tools",
  soul: "/soul",
  automations: "/automations",
  tasks: "/tasks",
  settings: "/settings",
};

export function pathForPage(pageId: PageId): string {
  return PAGE_PATHS[pageId];
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
