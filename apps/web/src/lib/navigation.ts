import {
  BrainIcon,
  Building03Icon,
  Coins01Icon,
  DashboardSquare01Icon,
  Folder01Icon,
  LayoutGridIcon,
  Notification01Icon,
  PackageIcon,
  Plug01Icon,
  PlusSignSquareIcon,
  Settings01Icon,
  SharedWifiIcon,
  UserSquareIcon,
  WebhookIcon,
  WorkflowSquare01Icon,
} from "hugeicons-react";

type NavIcon = typeof SharedWifiIcon;

export type PageId =
  | "chat"
  | "customize"
  | "usage"
  | "files"
  | "profiles"
  | "soul"
  | "tools"
  | "skills"
  | "mcp"
  | "automations"
  | "integrations"
  | "organization"
  | "settings"
  | "providers"
  | "notifications"
  | "workers"
  | "plugins"
  | "plugin-management";

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
      navItem("files", "Your files", "Manage profile artifacts", Folder01Icon),
    ],
    label: "Chat",
  },
  {
    id: "agent",
    items: [
      navItem(
        "profiles",
        "Agent config",
        "Manage bot configs and tool allowlists",
        UserSquareIcon
      ),
      navItem(
        "automations",
        "Automations",
        "Manage scheduled automations",
        SharedWifiIcon
      ),
      navItem(
        "integrations",
        "Integrations",
        "Bridges and Composio",
        WebhookIcon
      ),
      navItem(
        "customize",
        "Customize",
        "Customize your workspace",
        DashboardSquare01Icon
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
      navItem("usage", "Usage", "View token usage and costs", Coins01Icon),
      navItem("plugin-management", "Plugins", "Manage plugins", PackageIcon),
      navItem(
        "workers",
        "Workers",
        "Automation and channel workers",
        DashboardSquare01Icon
      ),
      navItem("tools", "Tools", "Manage agent tools", LayoutGridIcon),
      navItem("skills", "Skills", "Browse organization skills", BrainIcon),
      navItem("mcp", "MCP", "Manage MCP servers", Plug01Icon),
      navItem(
        "providers",
        "LLM providers",
        "Manage provider API keys and models",
        BrainIcon
      ),
      navItem(
        "settings",
        "Settings",
        "Appearance and preferences",
        Settings01Icon
      ),
    ],
    label: "System",
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const SIDEBAR_PAGE_IDS: readonly PageId[] = [
  "chat",
  "files",
  "profiles",
  "automations",
  "integrations",
  "customize",
];

export const STANDALONE_PAGES: Partial<Record<PageId, NavItem>> = {
  notifications: navItem(
    "notifications",
    "Notifications",
    "Automation runs and org memory proposals",
    Notification01Icon
  ),
};

export const SETUP_PATH = "/setup";

export const PLATFORM_ADMIN_PAGE_IDS: ReadonlySet<PageId> = new Set([
  "files",
  "soul",
  "mcp",
  "providers",
  "skills",
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

export function canManagePluginReleases(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin;
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
        item.id === "usage" ||
        item.id === "plugin-management" ||
        item.id === "files" ||
        item.id === "tools" ||
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

export const toolsTabPath = (): string => PAGE_PATHS.tools;

export const pluginManagementPath = (): string =>
  PAGE_PATHS["plugin-management"];

export const PLUGIN_PAGE_PREFIX = "/plugins";

export function pluginPagePath(pluginId: string): string {
  return `${PLUGIN_PAGE_PREFIX}/${encodeURIComponent(pluginId)}`;
}

export function pluginIdFromPath(pathname: string): string | null {
  if (
    pathname === PLUGIN_PAGE_PREFIX ||
    pathname === `${PLUGIN_PAGE_PREFIX}/`
  ) {
    return null;
  }

  if (!pathname.startsWith(`${PLUGIN_PAGE_PREFIX}/`)) {
    return null;
  }

  const rest = pathname.slice(PLUGIN_PAGE_PREFIX.length + 1);
  if (!rest || rest.includes("/")) {
    return null;
  }

  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

export function pluginIcon(pluginId: string): NavIcon {
  switch (pluginId) {
    case "workflows":
      return WorkflowSquare01Icon;
    case "supermemory":
      return BrainIcon;
    default:
      return PackageIcon;
  }
}

export interface PluginNavEntry {
  href: string;
  label: string;
  pluginId: string;
}

export function enabledPluginNavEntries(
  plugins: ReadonlyArray<{
    lifecycleState: string;
    pluginId: string;
    ui: { pageLabel: string } | null;
  }>
): PluginNavEntry[] {
  return plugins
    .filter(
      (plugin) => plugin.lifecycleState === "enabled" && plugin.ui !== null
    )
    .toSorted((left, right) => {
      const leftLabel = left.ui?.pageLabel ?? left.pluginId;
      const rightLabel = right.ui?.pageLabel ?? right.pluginId;
      const byLabel = leftLabel.localeCompare(rightLabel);
      if (byLabel !== 0) {
        return byLabel;
      }
      return left.pluginId.localeCompare(right.pluginId);
    })
    .map((plugin) => ({
      href: pluginPagePath(plugin.pluginId),
      label: plugin.ui?.pageLabel ?? plugin.pluginId,
      pluginId: plugin.pluginId,
    }));
}

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
    href:
      searchParams.get("from") === "skills"
        ? PAGE_PATHS.skills
        : PAGE_PATHS.profiles,
    label: searchParams.get("from") === "skills" ? "Skills" : "Profiles",
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
  customize: "/customize",
  files: "/files",
  integrations: "/integrations",
  mcp: "/customize/mcp",
  notifications: "/notifications",
  organization: "/organization",
  "plugin-management": "/customize/plugins",
  plugins: PLUGIN_PAGE_PREFIX,
  profiles: "/profiles",
  providers: "/customize/providers",
  settings: "/settings",
  skills: "/customize/skills",
  soul: "/system",
  tools: "/customize/tools",
  usage: "/customize/usage",
  workers: "/workers",
};

const PREFIX_PAGE_IDS: readonly [string, PageId][] = [
  [PAGE_PATHS["plugin-management"], "plugin-management"],
  [PAGE_PATHS.chat, "chat"],
  [PAGE_PATHS.soul, "soul"],
  [PAGE_PATHS.profiles, "profiles"],
  [PAGE_PATHS.files, "files"],
  [PAGE_PATHS.plugins, "plugins"],
];

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
