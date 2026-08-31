import { describe, expect, test } from "bun:test";
import {
  agentWorkTabFromSearchParams,
  agentWorkTabPath,
  orgSkillProposalsPath,
  pageIdFromPath,
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

describe("agent work navigation", () => {
  test("defaults the unified page to automations", () => {
    expect(agentWorkTabFromSearchParams(new URLSearchParams())).toBe(
      "automations"
    );
    expect(
      agentWorkTabFromSearchParams(new URLSearchParams("tab=unknown"))
    ).toBe("automations");
  });

  test("reads the tasks tab from the URL", () => {
    expect(agentWorkTabFromSearchParams(new URLSearchParams("tab=tasks"))).toBe(
      "tasks"
    );
  });

  test("builds canonical tab URLs", () => {
    expect(agentWorkTabPath("automations")).toBe(
      "/automations?tab=automations"
    );
    expect(agentWorkTabPath("tasks")).toBe("/automations?tab=tasks");
  });

  test("maps the legacy tasks path to the unified page", () => {
    expect(pageIdFromPath("/tasks")).toBe("automations");
    expect(pageIdFromPath("/automations")).toBe("automations");
  });
});

describe("workers navigation", () => {
  test("maps the workers path", () => {
    expect(pageIdFromPath("/workers")).toBe("workers");
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
