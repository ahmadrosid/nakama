import type { LucideIcon } from "lucide-react";
import {
  BellIcon,
  BrainIcon,
  CableIcon,
  CircleFadingPlusIcon,
  CircleUserRoundIcon,
  ClockIcon,
  CogIcon,
  KanbanIcon,
  WorkflowIcon,
} from "lucide-react";

export type PageId =
  | "chat"
  | "history"
  | "profiles"
  | "soul"
  | "automations"
  | "tasks"
  | "integrations"
  | "settings"
  | "notifications";

export interface NavItem {
  description: string;
  id: PageId;
  label: string;
}

export interface NavGroup {
  id: string;
  items: NavItem[];
  label: string;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "chat",
    items: [
      {
        description: "New chat",
        id: "chat",
        label: "New chat",
      },
      {
        description: "Browse and reopen saved chats",
        id: "history",
        label: "Chats",
      },
    ],
    label: "Chat",
  },
  {
    id: "agent",
    items: [
      {
        description: "Manage bot configs and tool allowlists",
        id: "profiles",
        label: "Profiles",
      },
      {
        description: "Draft workflows from natural language",
        id: "automations",
        label: "Automations",
      },
      {
        description: "Agent swarm kanban board",
        id: "tasks",
        label: "Tasks",
      },
    ],
    label: "Agent",
  },
  {
    id: "system",
    items: [
      {
        description: "Bridges and Composio",
        id: "integrations",
        label: "Integrations",
      },
      {
        description: "Identity stack files and registered agent tools",
        id: "soul",
        label: "System",
      },
      {
        description: "Provider API key and model",
        id: "settings",
        label: "Settings",
      },
    ],
    label: "System",
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const STANDALONE_PAGES: Partial<Record<PageId, NavItem>> = {
  notifications: {
    description: "Automation runs and org memory proposals",
    id: "notifications",
    label: "Notifications",
  },
};

export const NAV_ITEM_ICONS: Record<PageId, LucideIcon> = {
  automations: WorkflowIcon,
  chat: CircleFadingPlusIcon,
  history: ClockIcon,
  integrations: CableIcon,
  notifications: BellIcon,
  profiles: CircleUserRoundIcon,
  settings: CogIcon,
  soul: BrainIcon,
  tasks: KanbanIcon,
};

export const SETUP_PATH = "/setup";

export const PLATFORM_ADMIN_PAGE_IDS: ReadonlySet<PageId> = new Set([
  "profiles",
  "soul",
]);

export function canAccessSystemPage(
  isPlatformAdmin: boolean,
  orgRole: string | undefined
): boolean {
  return isPlatformAdmin || orgRole === "admin";
}

export function canAccessIntegrationsPage(
  orgRole: string | undefined
): boolean {
  return orgRole === "admin" || orgRole === "member";
}

export function canUseToolPlayground(
  isPlatformAdmin: boolean,
  orgRole: string | undefined
): boolean {
  return isPlatformAdmin || orgRole === "admin";
}

export function toolsTabPath(): string {
  return `${PAGE_PATHS.soul}?tab=tools`;
}

export function statusTabPath(): string {
  return `${PAGE_PATHS.soul}?tab=status`;
}

export function profilePath(profileId: string): string {
  return `${PAGE_PATHS.profiles}?profile=${encodeURIComponent(profileId)}`;
}

export function skillDetailPath(
  skillId: string,
  options?: { profileId?: string }
): string {
  const path = `${PAGE_PATHS.profiles}/skills/${encodeURIComponent(skillId)}`;
  if (!options?.profileId) {
    return path;
  }

  const params = new URLSearchParams({ profile: options.profileId });
  return `${path}?${params.toString()}`;
}

/** Resolve skill detail back-navigation from search params set by skillDetailPath. */
export function skillDetailBackTarget(searchParams: URLSearchParams): {
  href: string;
  label: string;
} {
  const profileId = searchParams.get("profile");
  if (profileId) {
    return { href: profilePath(profileId), label: "Profile" };
  }

  return { href: PAGE_PATHS.profiles, label: "Profiles" };
}

export function toolPlaygroundPath(
  toolId: string,
  options?: { fromProfileId?: string }
): string {
  const path = `${PAGE_PATHS.soul}/playground/${encodeURIComponent(toolId)}`;
  if (!options?.fromProfileId) {
    return path;
  }

  const params = new URLSearchParams({
    from: "profiles",
    profile: options.fromProfileId,
  });
  return `${path}?${params.toString()}`;
}

/** Resolve playground back-navigation from search params set by toolPlaygroundPath. */
export function toolPlaygroundBackTarget(searchParams: URLSearchParams): {
  href: string;
  label: string;
} {
  const fromProfileId =
    searchParams.get("from") === "profiles"
      ? searchParams.get("profile")
      : null;
  if (fromProfileId) {
    return { href: profilePath(fromProfileId), label: "Profile" };
  }
  return { href: toolsTabPath(), label: "Tools" };
}

export function orgSkillProposalsPath(profileId?: string): string {
  const params = new URLSearchParams({
    skillProposals: "proposals",
    tab: "organization",
  });
  if (profileId) {
    params.set("profileId", profileId);
  }
  return `${PAGE_PATHS.soul}?${params.toString()}`;
}

export const PAGE_PATHS: Record<PageId, string> = {
  automations: "/automations",
  chat: "/chat",
  history: "/history",
  integrations: "/integrations",
  notifications: "/notifications",
  profiles: "/profiles",
  settings: "/settings",
  soul: "/system",
  tasks: "/tasks",
};

export function pathForPage(pageId: PageId): string {
  return PAGE_PATHS[pageId];
}

export function navHrefForPage(
  pageId: PageId,
  chatProfileId?: string | null
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
  return (
    NAV_ITEMS.find((item) => item.id === pageId) ?? STANDALONE_PAGES[pageId]
  );
}

export function pageIdFromPath(pathname: string): PageId | null {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) {
    return "chat";
  }

  if (
    pathname === PAGE_PATHS.soul ||
    pathname.startsWith(`${PAGE_PATHS.soul}/`)
  ) {
    return "soul";
  }

  if (
    pathname === PAGE_PATHS.profiles ||
    pathname.startsWith(`${PAGE_PATHS.profiles}/`)
  ) {
    return "profiles";
  }

  for (const [pageId, path] of Object.entries(PAGE_PATHS) as [
    PageId,
    string,
  ][]) {
    if (pageId === "chat" || pageId === "profiles") {
      continue;
    }

    if (pathname === path) {
      return pageId;
    }
  }

  return null;
}
