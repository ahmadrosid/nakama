import { describe, expect, test } from "bun:test";
import {
  canManageOrgPlugins,
  canManagePluginReleases,
  canOpenPluginPage,
  enabledPluginNavEntries,
  orgSkillProposalsPath,
  pageIdFromPath,
  pluginIdFromPath,
  pluginPagePath,
  pluginsSystemPath,
  visibleNavGroups,
} from "./navigation";

const pageIdsFor = (isPlatformAdmin: boolean, orgRole: string | undefined) =>
  visibleNavGroups({ isPlatformAdmin, orgRole })
    .flatMap((group) => group.items)
    .map((item) => item.id)
    .sort();

describe("visibleNavGroups", () => {
  test("a platform admin sees every destination", () => {
    expect(pageIdsFor(true, "admin")).toEqual([
      "automations",
      "chat",
      "files",
      "history",
      "integrations",
      "organization",
      "profiles",
      "settings",
      "soul",
      "workers",
    ]);
  });

  test("an org admin gets System, Organization, and Profiles but not platform-admin pages", () => {
    // `soul` is in PLATFORM_ADMIN_PAGE_IDS yet reachable by an org admin: the
    // canAccessSystemPage branch runs before the platform-admin check.
    const ids = pageIdsFor(false, "admin");
    expect(ids).toContain("soul");
    expect(ids).toContain("organization");
    expect(ids).toContain("profiles");
    expect(ids).toContain("integrations");
    expect(ids).toContain("workers");
    expect(ids).not.toContain("files");
  });

  test("a member loses System and Organization, a viewer also loses Integrations", () => {
    const member = pageIdsFor(false, "member");
    expect(member).toContain("integrations");
    expect(member).not.toContain("soul");
    expect(member).not.toContain("organization");
    expect(member).not.toContain("workers");

    const viewer = pageIdsFor(false, "viewer");
    expect(viewer).not.toContain("integrations");
    expect(viewer).not.toContain("soul");
    expect(viewer).not.toContain("organization");
    expect(viewer).not.toContain("workers");
  });

  test("groups left with no reachable item are dropped", () => {
    const groups = visibleNavGroups({
      isPlatformAdmin: false,
      orgRole: "viewer",
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

describe("plugin navigation", () => {
  test("maps plugin page paths and the System plugins tab", () => {
    expect(pluginPagePath("notes")).toBe("/plugins/notes");
    expect(pluginIdFromPath("/plugins/notes")).toBe("notes");
    expect(pluginIdFromPath("/plugins")).toBeNull();
    expect(pageIdFromPath("/plugins/notes")).toBe("plugins");
    expect(pluginsSystemPath()).toBe("/system?tab=plugins");
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
    expect(entries[0]?.label).toBe("Notes (alpha)");
    expect(entries[1]?.label).toBe("Notes (zeta)");
  });

  test("members can open pages; viewers cannot; org admins manage", () => {
    expect(canOpenPluginPage("member")).toBe(true);
    expect(canOpenPluginPage("admin")).toBe(true);
    expect(canOpenPluginPage("viewer")).toBe(false);
    expect(canManageOrgPlugins(false, "admin")).toBe(true);
    expect(canManageOrgPlugins(false, "member")).toBe(false);
    expect(canManagePluginReleases(true)).toBe(true);
    expect(canManagePluginReleases(false)).toBe(false);
  });
});

describe("organization navigation", () => {
  test("maps the organization path", () => {
    expect(pageIdFromPath("/organization")).toBe("organization");
  });

  test("builds skill proposal deep links on the organization page", () => {
    expect(orgSkillProposalsPath("p1")).toBe(
      "/organization?skillProposals=proposals&profileId=p1"
    );
  });
});
