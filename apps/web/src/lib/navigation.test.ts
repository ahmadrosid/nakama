import { describe, expect, test } from "bun:test";
import {
  canAccessIntegrationsPage,
  canAccessOrganizationPage,
  canAccessSystemPage,
  canManagePluginReleases,
  canOpenPage,
  enabledPluginNavEntries,
  groupPath,
  groupRouteFromPath,
  inAppLinkPath,
  pageIdFromPath,
  settingsPathFromLegacy,
  visibleNavGroups,
} from "./navigation";

const pageIdsFor = (isPlatformAdmin: boolean, orgRole: string | undefined) =>
  visibleNavGroups({ isPlatformAdmin, orgRole })
    .flatMap((group) => group.items)
    .map((item) => item.id)
    .sort();

describe("visibleNavGroups", () => {
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

test("Customize is reachable for every organization role", () => {
  expect(pageIdFromPath("/settings")).toBe("customize");

  for (const role of ["admin", "member"]) {
    expect(pageIdsFor(false, role)).toContain("customize");
  }
});

test("old /customize links still resolve to Settings pages", () => {
  expect(pageIdFromPath("/settings/preferences")).toBe("settings");
  expect(pageIdFromPath("/customize")).toBe("customize");
  expect(pageIdFromPath("/customize/providers")).toBe("providers");
  expect(pageIdFromPath("/customize/connections/notifications")).toBe(
    "customize"
  );
  expect(settingsPathFromLegacy("/customize/plugins/abc")).toBe(
    "/settings/plugins/abc"
  );
  expect(settingsPathFromLegacy("/customizer")).toBeNull();
});

describe("plugin navigation", () => {
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

describe("inAppLinkPath", () => {
  const origin = "http://localhost:4310";

  test("keeps a relative path to a known page with its hash", () => {
    expect(inAppLinkPath("/settings/providers#image-generation", origin)).toBe(
      "/settings/providers#image-generation"
    );
  });

  test("accepts a same-origin URL to a known page", () => {
    expect(inAppLinkPath(`${origin}/settings?tab=a`, origin)).toBe(
      "/settings?tab=a"
    );
  });

  test("rejects other sites, unknown paths, and protocol-relative links", () => {
    expect(inAppLinkPath("https://example.com/settings", origin)).toBeNull();
    expect(inAppLinkPath("/does-not-exist", origin)).toBeNull();
    expect(inAppLinkPath("//example.com/settings", origin)).toBeNull();
    expect(inAppLinkPath("mailto:a@example.com", origin)).toBeNull();
  });
});

describe("canOpenPage", () => {
  test("AI Providers opens for a platform admin only", () => {
    expect(
      canOpenPage("providers", { isPlatformAdmin: true, orgRole: "member" })
    ).toBe(true);
    expect(
      canOpenPage("providers", { isPlatformAdmin: false, orgRole: "admin" })
    ).toBe(false);
  });

  test("Tools opens for an org admin, not a member", () => {
    expect(
      canOpenPage("tools", { isPlatformAdmin: false, orgRole: "admin" })
    ).toBe(true);
    expect(
      canOpenPage("tools", { isPlatformAdmin: false, orgRole: "member" })
    ).toBe(false);
  });

  test("Settings opens for a viewer", () => {
    expect(
      canOpenPage("settings", { isPlatformAdmin: false, orgRole: "viewer" })
    ).toBe(true);
  });
});
