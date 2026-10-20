import { describe, expect, test } from "bun:test";
import {
  canAccessIntegrationsPage,
  canAccessOrganizationPage,
  canAccessSystemPage,
  canManagePluginReleases,
  enabledPluginNavEntries,
  groupPath,
  groupRouteFromPath,
  orgSkillProposalsPath,
  pageIdFromPath,
  pluginIdFromPath,
  pluginManagementPath,
  pluginPagePath,
  SIDEBAR_PAGE_IDS,
  sidebarPageId,
  skillDetailBackTarget,
  visibleNavGroups,
} from "./navigation";

const pageIdsFor = (isPlatformAdmin: boolean, orgRole: string | undefined) =>
  visibleNavGroups({ isPlatformAdmin, orgRole })
    .flatMap((group) => group.items)
    .map((item) => item.id)
    .sort();

describe("visibleNavGroups", () => {
  test("skills navigation returns to the organization catalog", () => {
    expect(pageIdFromPath("/customize/skills")).toBe("skills");
    expect(skillDetailBackTarget(new URLSearchParams("from=skills"))).toEqual({
      href: "/customize/skills",
      label: "Skills",
    });
    expect(pageIdsFor(false, "admin")).not.toContain("skills");
  });
  test("a platform admin sees every destination", () => {
    expect(pageIdsFor(true, "admin")).toEqual([
      "automations",
      "chat",
      "composio",
      "customize",
      "files",
      "google-meet",
      "groups",
      "mcp",
      "organization",
      "plugin-management",
      "profiles",
      "providers",
      "settings",
      "skills",
      "tools",
      "usage",
      "workers",
    ]);
  });

  test("an org admin can reach Knowledge through Your files", () => {
    const ids = pageIdsFor(false, "admin");
    expect(ids).toContain("tools");
    expect(ids).not.toContain("mcp");
    expect(ids).not.toContain("providers");
    expect(ids).toContain("organization");
    expect(ids).toContain("profiles");
    expect(ids).not.toContain("integrations");
    expect(ids).toContain("workers");
    expect(ids).toContain("files");
    expect(ids).toContain("plugin-management");
    expect(ids).toContain("usage");
  });

  test("members can access Organization and Files without system destinations", () => {
    const member = pageIdsFor(false, "member");
    expect(member).not.toContain("integrations");
    expect(member).not.toContain("tools");
    expect(member).not.toContain("mcp");
    expect(member).toContain("organization");
    expect(member).not.toContain("workers");
    expect(member).toContain("files");
    expect(member).not.toContain("plugin-management");
    expect(member).not.toContain("usage");
  });

  test("groups left with no reachable item are dropped", () => {
    const groups = visibleNavGroups({
      isPlatformAdmin: false,
      orgRole: undefined,
    });

    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });
});

describe("automations navigation", () => {
  test("maps the automations path and the legacy tasks redirect target", () => {
    expect(pageIdFromPath("/tasks")).toBe("automations");
    expect(pageIdFromPath("/automations")).toBe("automations");
  });
});

describe("workers navigation", () => {
  test("maps the workers path", () => {
    expect(pageIdFromPath("/workers")).toBe("workers");
  });
});

test("Customize is reachable for every organization role", () => {
  expect(pageIdFromPath("/customize")).toBe("customize");

  for (const role of ["admin", "member"]) {
    expect(pageIdsFor(false, role)).toContain("customize");
  }
});

describe("plugin navigation", () => {
  test("maps plugin pages and management under Customize", () => {
    expect(pluginPagePath("notes")).toBe("/plugins/notes");
    expect(pluginIdFromPath("/plugins/notes")).toBe("notes");
    expect(pluginIdFromPath("/plugins")).toBeNull();
    expect(pageIdFromPath("/plugins/notes")).toBe("plugins");
    expect(pageIdFromPath("/google-meet")).toBe("google-meet");
    expect(pluginManagementPath()).toBe("/customize/plugins");
    expect(pageIdFromPath("/customize/plugins")).toBe("plugin-management");
    expect(pageIdFromPath("/customize/plugins/notes")).toBe(
      "plugin-management"
    );
  });

  test("shows Plugins as a tab of the Connections sidebar item", () => {
    expect(SIDEBAR_PAGE_IDS).toContain("composio");
    expect(SIDEBAR_PAGE_IDS).not.toContain("plugin-management");
    expect(sidebarPageId("plugin-management")).toBe("composio");
    expect(sidebarPageId("automations")).toBe("automations");
  });

  test("lists enabled pages only, sorted by label then plugin id", () => {
    const entries = enabledPluginNavEntries([
      {
        lifecycleState: "enabled",
        pluginId: "zeta",
        ui: { pageLabel: "Notes" },
      },
      {
        lifecycleState: "enabled",
        pluginId: "alpha",
        ui: { pageLabel: "Notes" },
      },
      {
        lifecycleState: "disabled",
        pluginId: "off",
        ui: { pageLabel: "Off" },
      },
      {
        lifecycleState: "enabled",
        pluginId: "headless",
        ui: null,
      },
    ]);

    expect(entries.map((entry) => entry.pluginId)).toEqual(["alpha", "zeta"]);
    expect(entries[0]?.label).toBe("Notes");
    expect(entries[1]?.label).toBe("Notes");
  });

  test("members can open pages; org admins manage", () => {
    expect(canAccessIntegrationsPage("member")).toBe(true);
    expect(canAccessIntegrationsPage("admin")).toBe(true);
    expect(canAccessIntegrationsPage(undefined)).toBe(false);
    expect(canAccessSystemPage(false, "admin")).toBe(true);
    expect(canAccessSystemPage(false, "member")).toBe(false);
    expect(canManagePluginReleases(true)).toBe(true);
    expect(canManagePluginReleases(false)).toBe(false);
  });
});

describe("organization navigation", () => {
  test("requires a tenant role or platform authority", () => {
    for (const role of ["admin", "member"]) {
      expect(canAccessOrganizationPage(false, role)).toBe(true);
    }

    expect(canAccessOrganizationPage(false, undefined)).toBe(false);
    expect(canAccessOrganizationPage(false, "unknown")).toBe(false);
    expect(canAccessOrganizationPage(true, undefined)).toBe(true);
    expect(pageIdsFor(false, undefined)).not.toContain("organization");
  });
  test("maps the organization path", () => {
    expect(pageIdFromPath("/organization")).toBe("organization");
  });

  test("builds skill proposal deep links on the organization page", () => {
    expect(orgSkillProposalsPath("p1")).toBe(
      "/organization?skillProposals=proposals&profileId=p1"
    );
  });
});

test("the removed History page has no navigation destination", () => {
  expect(pageIdFromPath("/history")).toBeNull();
});

test("Usage lives under Customize", () => {
  expect(pageIdFromPath("/customize/usage")).toBe("usage");
});

test("a group path names the group and, inside a chat, the session", () => {
  expect(groupRouteFromPath(groupPath("g 1"))).toEqual({
    groupId: "g 1",
    sessionId: null,
  });
  expect(groupRouteFromPath(groupPath("g1", "s1"))).toEqual({
    groupId: "g1",
    sessionId: "s1",
  });
  expect(groupRouteFromPath("/groups")).toBeNull();
  expect(groupRouteFromPath("/groups/")).toBeNull();
  expect(groupRouteFromPath("/chat/g1/s1")).toBeNull();
  expect(pageIdFromPath(groupPath("g1", "s1"))).toBe("groups");
});
