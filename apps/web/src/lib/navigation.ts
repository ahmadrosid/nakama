import {
  Brain03Icon,
  Building03Icon,
  Chat01Icon,
  DashboardSquare01Icon,
  Folder01Icon,
  Notification01Icon,
  PlusSignSquareIcon,
  Settings01Icon,
  SharedWifiIcon,
  UserSquareIcon,
  WebhookIcon,
} from "hugeicons-react";

type NavIcon = typeof SharedWifiIcon;

export type PageId =
  | "chat"
  | "history"
  | "files"
  | "profiles"
  | "soul"
  | "automations"
  | "integrations"
  | "organization"
  | "settings"
  | "notifications"
  | "workers";

export interface NavItem {
  description: string;
  icon: NavIcon;
  id: PageId;
  label: string;
}

export interface NavGroup {
  /** When true, sidebar renders a collapsible tree under `label`. */
  collapsible?: boolean;
  id: string;
  items: NavItem[];
  label: string;
}

const navItem = (
  id: PageId,
  label: string,
  description: string,
  icon: NavIcon
): NavItem => ({
  description,
  icon,
  id,
  label,
});

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "chat",
    items: [
      navItem(
        "chat",
        "New chat",
        "Start a new conversation",
        PlusSignSquareIcon
      ),
      navItem("history", "Chats", "Browse and reopen saved chats", Chat01Icon),
      navItem("files", "Files", "Manage profile artifacts", Folder01Icon),
    ],
    label: "Chat",
  },
  {
    id: "agent",
    items: [
      navItem(
        "profiles",
        "Profiles",
        "Manage bot configs and tool allowlists",
        UserSquareIcon
      ),
      navItem(
        "automations",
        "Automations",
        "Manage scheduled automations",
        SharedWifiIcon
      ),
    ],
    label: "Agent",
  },
  {
    id: "organization",
    items: [
      navItem(
        "organization",
        "Organization",
        "Members, memory, and org settings",
        Building03Icon
      ),
    ],
    label: "Organization",
  },
  {
    collapsible: true,
    id: "system",
    items: [
      navItem(
        "workers",
        "Workers",
        "Automation and channel workers",
        DashboardSquare01Icon
      ),
      navItem(
        "integrations",
        "Integrations",
        "Bridges and Composio",
        WebhookIcon
      ),
      navItem(
        "soul",
        "System",
        "Identity stack files and registered agent tools",
        Brain03Icon
      ),
      navItem(
        "settings",
        "Settings",
        "Provider API key and model",
        Settings01Icon
      ),
    ],
    label: "System",
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const STANDALONE_PAGES: Partial<Record<PageId, NavItem>> = {
  notifications: navItem(
    "notifications",
    "Notifications",
    "Automation runs and org memory proposals",
    Notification01Icon
  ),
};

const navItemsWithIcons = [
  ...NAV_ITEMS,
  ...Object.values(STANDALONE_PAGES).filter(
    (item): item is NavItem => item !== undefined
  ),
];

/** Compatibility lookup for consumers that only need an icon by page id. */
export const NAV_ITEM_ICONS: Record<PageId, NavIcon> = {
  ...(Object.fromEntries(
    navItemsWithIcons.map((item) => [item.id, item.icon])
  ) as Record<PageId, NavIcon>),
};

export const SETUP_PATH = "/setup";

export const PLATFORM_ADMIN_PAGE_IDS: ReadonlySet<PageId> = new Set([
  "files",
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

export const canUseToolPlayground = canAccessSystemPage;

/**
 * Nav groups this user can actually reach, empty groups dropped. The sidebar and
 * the command palette both read this, so the palette cannot offer a destination
 * the sidebar hides.
 */
export function visibleNavGroups(access: {
  isPlatformAdmin: boolean;
  orgRole: string | undefined;
}): NavGroup[] {
  const groups: NavGroup[] = [];

  for (const group of NAV_GROUPS) {
    const items = group.items.filter((item) => {
      if (
        item.id === "soul" ||
        item.id === "profiles" ||
        item.id === "organization" ||
        item.id === "workers"
      ) {
        return canAccessSystemPage(access.isPlatformAdmin, access.orgRole);
      }

      if (item.id === "integrations") {
        return canAccessIntegrationsPage(access.orgRole);
      }

      return !PLATFORM_ADMIN_PAGE_IDS.has(item.id) || access.isPlatformAdmin;
    });

    if (items.length > 0) {
      groups.push({ ...group, items });
    }
  }

  return groups;
}

const queryPath = (path: string, params: Record<string, string>): string =>
  `${path}?${new URLSearchParams(params)}`;

export const toolsTabPath = (): string =>
  queryPath(PAGE_PATHS.soul, { tab: "tools" });

export const profilePath = (profileId: string): string =>
  queryPath(PAGE_PATHS.profiles, { profile: profileId });

export function skillDetailPath(
  skillId: string,
  options?: { profileId?: string }
): string {
  const path = `${PAGE_PATHS.profiles}/skills/${encodeURIComponent(skillId)}`;
  return options?.profileId
    ? queryPath(path, { profile: options.profileId })
    : path;
}

const backTarget = (
  profileId: string | null,
  fallback: { href: string; label: string }
): { href: string; label: string } =>
  profileId ? { href: profilePath(profileId), label: "Profile" } : fallback;

/** Resolve skill detail back-navigation from search params set by skillDetailPath. */
export const skillDetailBackTarget = (
  searchParams: URLSearchParams
): {
  href: string;
  label: string;
} =>
  backTarget(searchParams.get("profile"), {
    href: PAGE_PATHS.profiles,
    label: "Profiles",
  });

export function toolPlaygroundPath(
  toolId: string,
  options?: { fromProfileId?: string }
): string {
  const path = `${PAGE_PATHS.soul}/playground/${encodeURIComponent(toolId)}`;
  return options?.fromProfileId
    ? queryPath(path, { from: "profiles", profile: options.fromProfileId })
    : path;
}

/** Resolve playground back-navigation from search params set by toolPlaygroundPath. */
export const toolPlaygroundBackTarget = (
  searchParams: URLSearchParams
): {
  href: string;
  label: string;
} =>
  backTarget(
    searchParams.get("from") === "profiles"
      ? searchParams.get("profile")
      : null,
    { href: toolsTabPath(), label: "Tools" }
  );

export function orgSkillProposalsPath(profileId?: string): string {
  const params = new URLSearchParams({
    skillProposals: "proposals",
  });
  if (profileId) {
    params.set("profileId", profileId);
  }
  return `${PAGE_PATHS.organization}?${params.toString()}`;
}

export const PAGE_PATHS: Record<PageId, string> = {
  automations: "/automations",
  chat: "/chat",
  files: "/files",
  history: "/history",
  integrations: "/integrations",
  notifications: "/notifications",
  organization: "/organization",
  profiles: "/profiles",
  settings: "/settings",
  soul: "/system",
  workers: "/workers",
};

const PREFIX_PAGE_IDS: readonly [string, PageId][] = [
  [PAGE_PATHS.chat, "chat"],
  [PAGE_PATHS.soul, "soul"],
  [PAGE_PATHS.profiles, "profiles"],
  [PAGE_PATHS.files, "files"],
];

export type AgentWorkTab = "automations" | "workflows";

export function agentWorkTabFromSearchParams(
  searchParams: URLSearchParams
): AgentWorkTab {
  return searchParams.get("tab") === "workflows" ? "workflows" : "automations";
}

export function agentWorkTabPath(tab: AgentWorkTab): string {
  return `${PAGE_PATHS.automations}?tab=${tab}`;
}

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
  if (pathname === "/tasks") {
    return "automations";
  }

  const prefixPage = PREFIX_PAGE_IDS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (prefixPage) {
    return prefixPage[1];
  }

  return (
    (Object.entries(PAGE_PATHS) as [PageId, string][]).find(
      ([, path]) => pathname === path
    )?.[0] ?? null
  );
}
