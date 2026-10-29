import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  ModelsResponse,
  OrganizationOverviewResponse,
  OrganizationSummary,
  ProfileResponse,
  ProfileSummary,
  SkillSummary,
  SoulStatusResponse,
  ToolResponse,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { OrgSettingsProfileBooleanOverrideField } from "@/components/profiles/ProfileOrgBooleanOverrideField";
import { ProfileSkillsSettingsSection } from "@/components/profiles/ProfileSkillsSettingsSection";
import { OrgMembersCard } from "@/components/settings/OrgMembersCard";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { SOUL_FILES } from "@/components/soul-tools/soul-files";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { OrganizationPage } from "@/pages/OrganizationPage";
import {
  ProfileConfigIdentitySection,
  ProfileSystemPromptCard,
} from "@/pages/profiles/profile-config-identity-section";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import { ProfilesDialogs } from "@/pages/profiles/profiles-dialogs";
import { useProfilesPage } from "@/pages/profiles/use-profiles-page";
import { TeamDetailPage } from "@/pages/TeamDetailPage";
import { OrganizationOverview } from "./OrganizationPanel";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function organization(id: string): OrganizationSummary {
  return {
    createdAt: "2026-10-12T00:00:00Z",
    id,
    name: id,
    parentOrgId: "parent",
    slug: id,
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

function overview(id: string): OrganizationOverviewResponse {
  return {
    activeOrgId: id,
    canManageOrganization: false,
    organization: { id: "parent", name: `Parent for ${id}` },
    sharedResources: (
      ["knowledge", "skill", "agent", "tool", "model"] as const
    ).map((resourceKind) => ({
      createdAt: "2026-10-12T00:00:00Z",
      id: `${id}-${resourceKind}`,
      label: `${id} ${resourceKind}`,
      orgId: "parent",
      readiness: "ready",
      resourceId: resourceKind,
      resourceKind,
      sourceOrganization: { id: "parent", name: "Parent" },
      updatedAt: "2026-10-12T00:00:00Z",
    })),
    teams: [
      {
        canSwitch: true,
        id,
        isCurrent: true,
        localResourceCounts: { agents: 3, knowledge: 5, skills: 4, tools: 2 },
        memberCount: 14,
        name: `Team ${id}`,
        slug: id,
      },
    ],
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function ChatLocation() {
  const location = useLocation();

  return (
    <output data-chat-location>
      {location.pathname}
      {location.search}
    </output>
  );
}

function mount(
  queryClient: QueryClient,
  switchOrg: AuthContextValue["switchOrg"] = async () => undefined,
  refreshSession: AuthContextValue["refreshSession"] = async () => undefined,
  user: AuthContextValue["user"] = {
    email: "creator@example.com",
    id: "creator",
  },
  content?: ReactNode,
  orgs: AuthContextValue["orgs"] = [],
  initialPath = "/system/organization"
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  return {
    container,
    async render(
      org: NonNullable<AuthContextValue["activeOrg"]>,
      page = false
    ) {
      const auth: AuthContextValue = {
        activeOrg: org,
        archiveOrg: async () => undefined,
        createOrg: async () => undefined,
        isAuthenticated: true,
        isLoading: false,
        login: async () => {
          throw new Error("Unused login");
        },
        logout: async () => undefined,
        orgs,
        platformOrgs: [],
        platformOrgsError: false,
        refreshPlatformOrgs: async () => undefined,
        refreshSession,
        setup: async () => undefined,
        switchOrg,
        updateOrg: async () => undefined,
        user,
      };

      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialPath]}>
              <AuthContext.Provider value={auth}>
                {content ??
                  (page ? <OrganizationPage /> : <OrganizationOverview />)}
                <ChatLocation />
              </AuthContext.Provider>
            </MemoryRouter>
          </QueryClientProvider>
        );
        await settle();
      });
      await act(async () => {
        await settle();
      });
    },
  };
}

for (const role of ["member"] as const) {
  for (const context of ["team", "root"] as const) {
    test(`${context} ${role} can read the page without admin requests`, async () => {
      const queries = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        },
      });

      const org = {
        ...organization(context),
        parentOrgId: context === "team" ? "parent" : null,
        role,
      };

      const data = overview(org.id);

      if (context === "root") {
        data.organization = { id: org.id, name: org.name };
      }

      const request = spyOn(
        client,
        "getOrganizationOverview"
      ).mockResolvedValue(data);

      const members = spyOn(client, "listOrgMembers");
      const memory = spyOn(client, "getOrgMemory");
      const proposals = spyOn(client, "listSkillProposals");
      const curator = spyOn(client, "getOrgSkillCuratorLatest");
      const profiles = spyOn(client, "listProfiles");
      cleanups.push(() => {
        request.mockRestore();
        members.mockRestore();
        memory.mockRestore();
        proposals.mockRestore();
        curator.mockRestore();
        profiles.mockRestore();
      });

      const { container, render } = mount(queries);
      await render(org, true);
      expect(request).toHaveBeenCalledWith(org.id);
      expect(container.querySelector("h2")?.textContent).toBe(
        data.organization.name
      );
      expect(
        container.querySelector("dl")?.querySelectorAll("dt")
      ).toHaveLength(5);
      expect(container.querySelectorAll("li")).toHaveLength(data.teams.length);
      expect(container.querySelectorAll("h2")).toHaveLength(1);
      expect(members).not.toHaveBeenCalled();
      expect(memory).not.toHaveBeenCalled();
      expect(proposals).not.toHaveBeenCalled();
      expect(curator).not.toHaveBeenCalled();
      expect(profiles).not.toHaveBeenCalled();
    });
  }
}

test.each([true, false])(
  "team switcher retains scoped selection when collapsed=%s",
  async (collapsed) => {
    const queries = new QueryClient();

    const team = {
      ...organization("team-a"),
      name: "Shared name",
      role: "admin" as const,
    };

    const root = {
      ...organization("root"),
      name: "Shared name",
      parentOrgId: null,
      role: "member" as const,
    };

    const switchOrg = mock(async (_id: string) => undefined);

    const { container, render } = mount(
      queries,
      switchOrg,
      undefined,
      undefined,
      <OrgSwitcher collapsed={collapsed} />,
      [team, root]
    );

    await render(team);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Current team: Shared name"]'
    )!;

    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger.focus();
      trigger.click();
      await settle();
    });

    const current = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Switch to team Shared name"]'
    )!;

    const other = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Switch to organization Shared name"]'
    )!;

    expect(current).not.toBeNull();
    expect(other).not.toBeNull();
    expect(
      current.querySelector('button[aria-label="Edit Shared name"]')
    ).not.toBeNull();
    expect(
      other.querySelector('button[aria-label="Edit Shared name"]')
    ).toBeNull();
    await act(async () => {
      current.click();
      await settle();
    });
    expect(switchOrg).not.toHaveBeenCalled();
    await act(async () => {
      trigger.click();
      await settle();
    });
    await act(async () => {
      document
        .querySelector<HTMLElement>(
          '[role="menuitem"][aria-label="Switch to organization Shared name"]'
        )!
        .click();
      await settle();
    });
    expect(switchOrg.mock.calls).toEqual([[root.id]]);
    await render(root);
    expect(
      container.querySelector(
        'button[aria-label="Current organization: Shared name"]'
      )
    ).not.toBeNull();
  }
);

test.each(["team", "parent", "standalone"] as const)(
  "%s settings keep scoped IDs and accessible member actions",
  async (context) => {
    const queries = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });

    const org = {
      ...organization(context),
      parentOrgId: context === "team" ? "parent" : null,
      role: "admin" as const,
    };

    const member = {
      createdAt: "2026-10-12T00:00:00Z",
      email: "writer@example.com",
      name: "Writer",
      phone: null,
      role: "member" as const,
      userId: "writer",
    };

    queries.setQueryData(queryKeys.orgMembers(org.id), { members: [member] });

    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard"
    );

    const write = mock(async (_value: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: write },
    });
    cleanups.push(() => {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    });

    const { container, render } = mount(
      queries,
      undefined,
      undefined,
      undefined,
      <OrgMembersCard />
    );

    await render(org);

    async function openTab(name: string) {
      const tab = [
        ...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
      ].find((entry) => entry.textContent === name)!;

      await act(async () => {
        tab.click();
        await settle();
      });
    }

    await openTab("Settings");
    const label = context === "team" ? "Team ID" : "Organization ID";
    expect(
      [...container.querySelectorAll("span")].some(
        (entry) => entry.textContent === label
      )
    ).toBe(true);
    expect(container.querySelector("code")?.textContent).toBe(org.id);
    const copyLabel = context === "team" ? "Copy team ID" : "Copy org ID";

    const copy = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copyLabel}"]`
    )!;

    expect(copy).not.toBeNull();
    expect(copy.disabled).toBe(false);
    await act(async () => copy.focus());
    expect(document.activeElement).toBe(copy);
    await act(async () => {
      copy.click();
      await settle();
    });
    expect(write).toHaveBeenCalledWith(org.id);
    await openTab("Members");

    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Writer"]'
    )!;

    expect(menu).not.toBeNull();
    await act(async () => {
      menu.click();
      await settle();
    });

    for (const name of [
      "Invite by email",
      "Add member",
      "Edit Writer",
      "Remove Writer",
    ]) {
      const action = document.querySelector<HTMLElement>(
        `[aria-label="${name}"]`
      )!;

      expect(action).not.toBeNull();
      expect(action.getAttribute("aria-disabled")).not.toBe("true");
    }

    const next = { ...org, id: `${org.id}-next` };
    queries.setQueryData(queryKeys.orgMembers(next.id), { members: [] });
    await render(next);
    await openTab("Settings");
    expect(container.querySelector("code")?.textContent).toBe(next.id);

    const nextCopy = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${copyLabel}"]`
    )!;

    expect(nextCopy).not.toBeNull();
    await act(async () => {
      nextCopy.click();
      await settle();
    });
    expect(write).toHaveBeenLastCalledWith(next.id);
    await render({ ...next, role: "member" });
    expect(container.querySelector("code")).toBeNull();
    expect(
      container.querySelector('button[aria-label="Add member"]')
    ).toBeNull();
  }
);

test("an admin revokes a pending invite from the members tab", async () => {
  const queries = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });

  const org = { ...organization("standalone"), role: "admin" as const };

  const invite = {
    createdAt: "2026-10-27T00:00:00Z",
    email: "guest@example.com",
    expiresAt: "2026-11-03T00:00:00Z",
    id: "invite_1",
    orgId: org.id,
    role: "member" as const,
  };

  queries.setQueryData(queryKeys.orgMembers(org.id), { members: [] });

  const list = spyOn(client, "listOrgInvites").mockResolvedValue({
    invites: [invite],
  });

  const revoke = spyOn(client, "revokeOrgInvite").mockResolvedValue();

  cleanups.push(() => {
    list.mockRestore();
    revoke.mockRestore();
  });

  const { container, render } = mount(
    queries,
    undefined,
    undefined,
    undefined,
    <OrgMembersCard />
  );

  await render(org);

  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Revoke invite for guest@example.com"]'
  )!;

  expect(button).not.toBeNull();
  list.mockResolvedValue({ invites: [] });
  await act(async () => {
    button.click();
    await settle();
  });

  expect(revoke).toHaveBeenCalledWith(org.id, invite.id);
  expect(container.querySelector('[aria-label="Pending invites"]')).toBeNull();
});

test("admin settings remain available and disappear after a role change", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const org = { ...organization("team-a"), role: "admin" as const };
  queries.setQueryData(
    queryKeys.organizationOverview("parent", org.id),
    overview(org.id)
  );
  const pending = new Promise<never>(() => undefined);

  const reads = [
    spyOn(client, "listOrgMembers").mockReturnValue(pending),
    spyOn(client, "getOrgMemory").mockReturnValue(pending),
    spyOn(client, "listSkillProposals").mockReturnValue(pending),
    spyOn(client, "getOrgSkillCuratorLatest").mockReturnValue(pending),
    spyOn(client, "listProfiles").mockReturnValue(pending),
    spyOn(client, "listOrgMemoryProposals").mockReturnValue(pending),
  ];

  cleanups.push(() => {
    for (const read of reads) {
      read.mockRestore();
    }
  });
  const { container, render } = mount(queries);
  await render(org, true);
  expect(container.querySelectorAll("h2")).toHaveLength(2);
  expect(reads[0]).toHaveBeenCalledWith(org.id);
  expect(reads[1]).toHaveBeenCalledWith(org.id);

  for (const read of reads) {
    read.mockClear();
  }

  await render({ ...org, role: "member" }, true);
  expect(container.querySelectorAll("h2")).toHaveLength(1);
  expect(container.querySelector("dl")?.querySelectorAll("dt")).toHaveLength(5);

  for (const read of reads) {
    expect(read).not.toHaveBeenCalled();
  }
});

test("renders all published resource kinds and stored team counts", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("team-a");
  data.sharedResources[3].readiness = "requires_setup";
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    data
  );
  const { container, render } = mount(queries);
  await render(organization("team-a"));
  expect(container.querySelector("h2")?.textContent).toBe(
    data.organization.name
  );

  for (const resource of data.sharedResources) {
    expect(container.textContent).toContain(resource.label);
  }

  expect(
    container.querySelectorAll("dl")[0].querySelectorAll("dt")
  ).toHaveLength(5);
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector("li a")?.textContent).toContain("14");

  const teamSummary = container.querySelector("li a")?.textContent ?? "";

  for (const count of ["3", "5", "4", "2"]) {
    expect(teamSummary).toContain(count);
  }

  expect(container.querySelectorAll("dd button")).toHaveLength(2);
});

test("long organization, resource, and team names retain accessible detail actions", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("team-a");
  data.organization.name = "Organization".repeat(30);

  for (const resource of data.sharedResources) {
    resource.label = `${resource.resourceKind}${"Resource".repeat(30)}`;
  }

  data.teams[0].name = "Team".repeat(60);
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    data
  );
  const switchOrg = mock(async (_id: string) => undefined);
  const { container, render } = mount(queries, switchOrg);
  await render(organization("team-a"));
  expect(container.querySelector("h2")?.textContent).toBe(
    data.organization.name
  );
  const rows = [...container.querySelector("dl")!.querySelectorAll("dd")];
  expect(rows).toHaveLength(5);

  for (const [index, resource] of data.sharedResources.entries()) {
    expect(rows[index].textContent).toContain(resource.label);
  }

  const team = container.querySelector<HTMLAnchorElement>("li a")!;
  expect(team.textContent).toContain(data.teams[0].name);
  expect(team.getAttribute("aria-label")).toBe(`View ${data.teams[0].name}`);
  expect(team.getAttribute("href")).toBe(
    `/organization/teams/${data.teams[0].id}`
  );
  await act(async () => team.focus());
  expect(document.activeElement).toBe(team);
  expect(switchOrg).not.toHaveBeenCalled();
});

test("a standalone organization with no publications or teams remains readable", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("standalone");

  data.organization = { id: "standalone", name: "Standalone" };
  data.sharedResources = [];
  data.teams = [];
  queries.setQueryData(
    queryKeys.organizationOverview("standalone", "standalone"),
    data
  );
  const { container, render } = mount(queries);
  await render({ ...organization("standalone"), parentOrgId: null });
  expect(container.querySelector("h2")?.textContent).toBe(
    data.organization.name
  );
  expect(container.querySelectorAll("dt")).toHaveLength(5);
  expect(container.querySelectorAll("li")).toHaveLength(0);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test("a failed overview can retry without changing organization scope", async () => {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const request = spyOn(client, "getOrganizationOverview")
    .mockRejectedValueOnce(new Error("Request failed"))
    .mockResolvedValue(overview("team-a"));

  cleanups.push(() => request.mockRestore());
  const { container, render } = mount(queries);
  await render(organization("team-a"));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => {
    container.querySelector("button")?.click();
    await settle();
  });
  expect(request.mock.calls).toEqual([["team-a"], ["team-a"]]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("team-a knowledge");
});

test("late overview responses cannot replace the newly selected team", async () => {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const first = Promise.withResolvers<OrganizationOverviewResponse>();
  const second = Promise.withResolvers<OrganizationOverviewResponse>();

  const request = spyOn(client, "getOrganizationOverview").mockImplementation(
    (id) => (id === "team-a" ? first.promise : second.promise)
  );

  cleanups.push(() => request.mockRestore());
  const { container, render } = mount(queries);
  await render(organization("team-a"));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await render(organization("team-b"));
  await act(async () => {
    second.resolve(overview("team-b"));
    await settle();
  });
  expect(container.textContent).toContain("team-b knowledge");
  await act(async () => {
    first.resolve(overview("team-a"));
    await settle();
  });
  expect(container.textContent).not.toContain("team-a knowledge");
  expect(container.textContent).toContain("team-b knowledge");
  expect(request.mock.calls).toEqual([["team-a"], ["team-b"]]);
});

async function mountTeamDetail(
  teamPatch: Partial<OrganizationOverviewResponse["teams"][number]>,
  switchOrg: AuthContextValue["switchOrg"]
) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("team-a");
  Object.assign(data.teams[0], { id: "team-b", isCurrent: false }, teamPatch);
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    data
  );

  const view = mount(
    queries,
    switchOrg,
    undefined,
    undefined,
    <Routes>
      <Route element={<TeamDetailPage />} path="/organization/teams/:teamId" />
      <Route element={<p>Chat</p>} path="/chat" />
    </Routes>,
    [
      {
        createdAt: "",
        id: "team-b",
        name: "Team b",
        role: "admin",
        slug: "team-b",
        updatedAt: "",
      },
    ],
    "/organization/teams/team-b"
  );

  await view.render(organization("team-a"));

  return view;
}

function locationOf(container: HTMLElement) {
  return container.querySelector("[data-chat-location]")?.textContent;
}

test("team detail shows readiness from stored counts without switching", async () => {
  const switchOrg = mock(async (_id: string) => undefined);

  const { container } = await mountTeamDetail(
    {
      localResourceCounts: { agents: 0, knowledge: 2, skills: 0, tools: 0 },
      memberCount: 1,
    },
    switchOrg
  );

  expect(container.querySelector("h2")?.textContent).toBe("Team team-a");
  expect(container.textContent).toContain("1/3");
  expect(container.textContent).toContain("Add person");
  expect(container.textContent).not.toContain("Add knowledge");
  expect(container.textContent).toContain("team-b");
  expect(switchOrg).not.toHaveBeenCalled();
});

test("work in this team switches once and opens chat after success", async () => {
  const pending = Promise.withResolvers<void>();
  const switchOrg = mock((_id: string) => pending.promise);
  const { container } = await mountTeamDetail({}, switchOrg);

  const work = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Work in this team"
  )!;

  await act(async () => {
    work.click();
    work.click();
    await settle();
  });
  expect(switchOrg.mock.calls).toEqual([["team-b"]]);
  expect(work.disabled).toBe(true);
  expect(locationOf(container)).toBe("/organization/teams/team-b");
  await act(async () => {
    pending.resolve();
    await settle();
  });
  expect(locationOf(container)).toBe("/chat");
});

async function addPersonOnTeamDetail(isCurrent: boolean) {
  const switchOrg = mock(async (_id: string) => undefined);

  const candidates = spyOn(client, "listParentOrgMembers").mockResolvedValue({
    members: [
      {
        createdAt: "2026-10-12T00:00:00Z",
        email: "new@example.com",
        name: "New Person",
        phone: null,
        role: "member",
        userId: "new-user",
      },
    ],
  });

  const add = spyOn(client, "addOrgMember").mockResolvedValue({
    member: {
      createdAt: "2026-10-12T00:00:00Z",
      email: "new@example.com",
      name: "New Person",
      phone: null,
      role: "member",
      userId: "new-user",
    },
    temporaryPassword: null,
  });

  cleanups.push(() => {
    add.mockRestore();
    candidates.mockRestore();
  });

  const { container } = await mountTeamDetail(
    {
      isCurrent,
      localResourceCounts: { agents: 0, knowledge: 0, skills: 0, tools: 0 },
      memberCount: 1,
    },
    switchOrg
  );

  const addPerson = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Add person"
  )!;

  await act(async () => {
    addPerson.click();
    await settle();
  });

  return { add, switchOrg };
}

test("add person on team detail selects an existing parent member in place", async () => {
  const { add, switchOrg } = await addPersonOnTeamDetail(true);

  expect(switchOrg).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('input[id$="-name"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "New Person"
  );

  await act(async () => {
    document
      .querySelector<HTMLInputElement>('input[name="team-person"]')
      ?.click();
  });
  await act(async () => {
    document
      .querySelector("[role=dialog] form")
      ?.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true })
      );
    await settle();
  });
  expect(add.mock.calls).toHaveLength(1);
  expect(add.mock.calls[0][0]).toBe("team-b");
  expect(add.mock.calls[0][1]).toMatchObject({
    email: "new@example.com",
    role: "member",
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("add person switches into the team first when it is not current", async () => {
  const { switchOrg } = await addPersonOnTeamDetail(false);

  expect(switchOrg.mock.calls).toEqual([["team-b"]]);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

test("team detail hides work action when switching is not permitted", async () => {
  const switchOrg = mock(async (_id: string) => undefined);

  const { container } = await mountTeamDetail(
    {
      canSwitch: false,
      localResourceCounts: { agents: 0, knowledge: 0, skills: 0, tools: 0 },
      memberCount: 1,
    },
    switchOrg
  );

  expect(container.textContent).not.toContain("Work in this team");

  const actions = [
    ...container.querySelectorAll<HTMLButtonElement>("li button"),
  ];

  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((button) => button.disabled)).toBe(true);
  expect(switchOrg).not.toHaveBeenCalled();
});

test("failed switch on team detail shows an error and permits retry", async () => {
  const switchOrg = mock(
    async (_id: string) => undefined
  ).mockRejectedValueOnce(new Error("Switch failed"));

  const { container } = await mountTeamDetail({}, switchOrg);

  const work = () =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Work in this team"
    )!;

  await act(async () => {
    work().click();
    await settle();
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(locationOf(container)).toBe("/organization/teams/team-b");
  await act(async () => {
    work().click();
    await settle();
  });
  expect(switchOrg.mock.calls).toEqual([["team-b"], ["team-b"]]);
  expect(locationOf(container)).toBe("/chat");
});

async function fillTeamForm(adminUserId = "creator") {
  await act(async () => {
    const input =
      document.querySelector<HTMLInputElement>('input[id$="-name"]');

    expect(input).not.toBeNull();
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    )?.set?.call(input, "Support");
    input?.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await act(async () => {
    document
      .querySelector<HTMLInputElement>(
        `input[name="team-admin"][value="${adminUserId}"]`
      )
      ?.click();
  });
}

async function submitTeamForm() {
  await act(async () => {
    document
      .querySelector("form")
      ?.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true })
      );
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

test.each(["creator", "another-user"])(
  "parent admins create a team for existing admin %s without switching",
  async (adminUserId) => {
    const queries = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });

    const data = overview("parent");
    data.canManageOrganization = true;
    data.teams = [];
    queries.setQueryData(queryKeys.orgMembers("parent"), {
      members: ["creator", "another-user"].map((userId) => ({
        createdAt: "2026-10-12T00:00:00Z",
        email: `${userId}@example.com`,
        name: userId,
        phone: null,
        role: "admin" as const,
        userId,
      })),
    });
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );

    const create = spyOn(client, "createTeam").mockResolvedValue({
      organization: organization("new-team"),
    });

    const reload = spyOn(client, "getOrganizationOverview").mockResolvedValue(
      data
    );

    cleanups.push(() => {
      create.mockRestore();
      reload.mockRestore();
    });
    const switchOrg = mock(async (_id: string) => undefined);
    const refreshSession = mock(async () => undefined);
    const { container, render } = mount(queries, switchOrg, refreshSession);
    await render({ ...organization("parent"), parentOrgId: null });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add team"]')
        ?.click();
      await settle();
    });
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="team-admin"]:checked'
      )?.value
    ).toBe("creator");
    await fillTeamForm(adminUserId);
    await submitTeamForm();
    expect(create).toHaveBeenCalledTimes(1);
    const [scope, request] = create.mock.calls[0];
    expect(scope).toBe("parent");
    expect(request).toMatchObject({
      adminUserId,
      name: "Support",
      slug: "support",
    });
    expect(request.requestId.length).toBeGreaterThan(0);
    expect(reload.mock.calls).toEqual([["parent"]]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(switchOrg).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(locationOf(container)).toBe("/organization/teams/new-team");
  }
);

test("failed team creation retains its request ID across dialog close and retry", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("parent");
  data.canManageOrganization = true;
  data.teams = [];
  queries.setQueryData(queryKeys.orgMembers("parent"), {
    members: ["creator", "another-user"].map((userId) => ({
      createdAt: "2026-10-12T00:00:00Z",
      email: `${userId}@example.com`,
      name: userId,
      phone: null,
      role: "admin" as const,
      userId,
    })),
  });
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    data
  );

  const create = spyOn(client, "createTeam")
    .mockRejectedValueOnce(new Error("Creation failed"))
    .mockResolvedValue({ organization: organization("new-team") });

  const reload = spyOn(client, "getOrganizationOverview").mockResolvedValue(
    data
  );

  cleanups.push(() => {
    create.mockRestore();
    reload.mockRestore();
  });
  const { container, render } = mount(queries);
  await render({ ...organization("parent"), parentOrgId: null });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Add team"]')
      ?.click();
    await settle();
  });
  await fillTeamForm();
  await submitTeamForm();
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
      ?.click();
    await settle();
  });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Add team"]')
      ?.click();
    await settle();
  });
  expect(
    document.querySelector<HTMLInputElement>('input[id$="-name"]')?.value
  ).toBe("Support");
  await submitTeamForm();
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("failed session refresh retries without creating a second team", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("parent");
  data.canManageOrganization = true;
  data.teams = [];
  queries.setQueryData(queryKeys.orgMembers("parent"), {
    members: ["creator", "another-user"].map((userId) => ({
      createdAt: "2026-10-12T00:00:00Z",
      email: `${userId}@example.com`,
      name: userId,
      phone: null,
      role: "admin" as const,
      userId,
    })),
  });
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    data
  );

  const create = spyOn(client, "createTeam").mockResolvedValue({
    organization: organization("new-team"),
  });

  const reload = spyOn(client, "getOrganizationOverview").mockResolvedValue(
    data
  );

  cleanups.push(() => {
    create.mockRestore();
    reload.mockRestore();
  });

  const refreshSession = mock(async () => undefined).mockRejectedValueOnce(
    new Error("Refresh failed")
  );

  const { container, render } = mount(
    queries,
    async () => undefined,
    refreshSession
  );

  await render({ ...organization("parent"), parentOrgId: null });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Add team"]')
      ?.click();
    await settle();
  });
  await fillTeamForm();
  await submitTeamForm();
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(
    [...document.querySelectorAll<HTMLInputElement>("form input")].every(
      (input) => input.disabled
    )
  ).toBe(true);
  await submitTeamForm();
  expect(create).toHaveBeenCalledTimes(1);
  expect(refreshSession).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("team creation blocks repeated submissions and keeps pending input fixed", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("parent");
  data.canManageOrganization = true;
  data.teams = [];
  queries.setQueryData(queryKeys.orgMembers("parent"), {
    members: ["creator", "another-user"].map((userId) => ({
      createdAt: "2026-10-12T00:00:00Z",
      email: `${userId}@example.com`,
      name: userId,
      phone: null,
      role: "admin" as const,
      userId,
    })),
  });
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    data
  );

  const pending = Promise.withResolvers<{
    organization: OrganizationSummary;
  }>();

  const create = spyOn(client, "createTeam").mockReturnValue(pending.promise);

  const reload = spyOn(client, "getOrganizationOverview").mockResolvedValue(
    data
  );

  cleanups.push(() => {
    create.mockRestore();
    reload.mockRestore();
  });
  const { container, render } = mount(queries);
  await render({ ...organization("parent"), parentOrgId: null });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Add team"]')
      ?.click();
    await settle();
  });
  await fillTeamForm();
  await submitTeamForm();
  await submitTeamForm();
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    [...document.querySelectorAll<HTMLInputElement>("form input")].every(
      (input) => input.disabled
    )
  ).toBe(true);
  expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
  await act(async () => {
    pending.resolve({ organization: organization("new-team") });
    await settle();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("team membership cannot expose parent team creation controls", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    overview("team-a")
  );
  const { container, render } = mount(queries);
  await render({ ...organization("team-a"), role: "admin" });
  expect(
    container.querySelectorAll('button[aria-label="Add team"]')
  ).toHaveLength(0);
  expect(
    container
      .querySelector<HTMLAnchorElement>("li a")
      ?.getAttribute("aria-label")
  ).toBe("View Team team-a");
});

async function mountKnowledgeManager() {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("parent");
  data.canManageOrganization = true;
  data.teams = [];
  queries.setQueryData(queryKeys.orgMembers("parent"), {
    members: ["creator", "another-user"].map((userId) => ({
      createdAt: "2026-10-12T00:00:00Z",
      email: `${userId}@example.com`,
      name: userId,
      phone: null,
      role: "admin" as const,
      userId,
    })),
  });
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    structuredClone(data)
  );

  const documents = (
    [
      { filename: "Brand guide", id: "doc-a", status: "ready" },
      { filename: "Existing publication", id: "knowledge", status: "ready" },
      { filename: "Failed extraction", id: "doc-failed", status: "failed" },
    ] as const
  ).map((document) => ({
    ...document,
    mediaType: "text/plain",
    scope: "organization" as const,
    sizeBytes: 42,
    uploadedAt: "2026-10-12T00:00:00Z",
  })) satisfies Awaited<
    ReturnType<typeof client.listOrganizationKnowledgeBase>
  >["documents"];

  const catalog = spyOn(
    client,
    "listOrganizationKnowledgeBase"
  ).mockResolvedValue({ documents });

  const reload = spyOn(client, "getOrganizationOverview").mockImplementation(
    async () => ({ ...data, sharedResources: [...data.sharedResources] })
  );

  cleanups.push(() => {
    catalog.mockRestore();
    reload.mockRestore();
  });
  const mounted = mount(queries);
  await mounted.render({ ...organization("parent"), parentOrgId: null });

  return { ...mounted, catalog, data, queries, reload };
}

async function openKnowledgeManager(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Manage shared knowledge"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

async function selectPublicationResource(expectedLabels = ["Brand guide"]) {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[role="combobox"]')?.click();
    await settle();
  });

  const options = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ];

  expect(options.map((option) => option.textContent)).toEqual(expectedLabels);
  await act(async () => {
    options[0]?.click();
    await settle();
  });
}

test("knowledge publication uses ready local document IDs and refreshes the catalog", async () => {
  const { container, catalog, data, reload } = await mountKnowledgeManager();

  const publication = {
    ...data.sharedResources[0],
    id: "pub-a",
    label: "Brand guide",
    resourceId: "doc-a",
  };

  const publish = spyOn(client, "publishOrgSharedResource").mockImplementation(
    async () => {
      data.sharedResources.push(publication);

      return { publication };
    }
  );

  cleanups.push(() => publish.mockRestore());
  expect(catalog).not.toHaveBeenCalled();
  await openKnowledgeManager(container);
  expect(catalog.mock.calls).toEqual([["parent"]]);
  await selectPublicationResource();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent === "Publish document")
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(publish.mock.calls).toEqual([
    ["parent", { resourceId: "doc-a", resourceKind: "knowledge" }],
  ]);
  expect(reload.mock.calls).toEqual([["parent"]]);
  expect(container.querySelector("dd")?.textContent).toContain("Brand guide");
  expect(
    document.querySelector('button[aria-label="Unpublish Brand guide"]')
  ).not.toBeNull();
});

test("failed publication keeps the catalog and selected document for retry", async () => {
  const { container, data } = await mountKnowledgeManager();

  const publication = {
    ...data.sharedResources[0],
    id: "pub-a",
    label: "Brand guide",
    resourceId: "doc-a",
  };

  const publish = spyOn(client, "publishOrgSharedResource")
    .mockRejectedValueOnce(new Error("Publish failed"))
    .mockResolvedValue({ publication });

  cleanups.push(() => publish.mockRestore());
  await openKnowledgeManager(container);
  await selectPublicationResource();

  const submit = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent === "Publish document");

  await act(async () => {
    submit?.click();
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(container.querySelector("dd")?.textContent).not.toContain(
    "Brand guide"
  );
  expect(container.querySelector("dd")?.textContent).toContain(
    "parent knowledge"
  );
  await act(async () => {
    submit?.click();
    await settle();
  });
  expect(publish.mock.calls).toEqual([
    ["parent", { resourceId: "doc-a", resourceKind: "knowledge" }],
    ["parent", { resourceId: "doc-a", resourceKind: "knowledge" }],
  ]);
});

test("failed unpublication keeps the published resource and permits retry", async () => {
  const { container, data, queries } = await mountKnowledgeManager();
  const toolKey = queryKeys.tools.published("team-a", "team-a-tool");
  const modelKey = [...queryKeys.models, "published", "team-a", "team-a-model"];
  queries.setQueryData(toolKey, publishedTool());
  queries.setQueryData(modelKey, { reference: "provider-a::model-a" });

  const unpublish = spyOn(client, "unpublishOrgSharedResource")
    .mockRejectedValueOnce(new Error("Unpublish failed"))
    .mockImplementation(async () => {
      data.sharedResources = data.sharedResources.filter(
        (resource) => resource.resourceKind !== "knowledge"
      );
    });

  cleanups.push(() => unpublish.mockRestore());
  await openKnowledgeManager(container);

  const submit = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Unpublish parent knowledge"]'
  );

  await act(async () => {
    submit?.click();
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(container.querySelector("dd")?.textContent).toContain(
    "parent knowledge"
  );
  expect(queries.getQueryState(toolKey)?.isInvalidated).toBe(false);
  expect(queries.getQueryState(modelKey)?.isInvalidated).toBe(false);
  await act(async () => {
    submit?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(unpublish.mock.calls).toEqual([
    ["parent", "parent-knowledge"],
    ["parent", "parent-knowledge"],
  ]);
  expect(container.querySelector("dd")?.textContent).not.toContain(
    "parent knowledge"
  );
  expect(queries.getQueryState(toolKey)?.isInvalidated).toBe(true);
  expect(queries.getQueryState(modelKey)?.isInvalidated).toBe(true);
});

test("catalog refresh failure preserves current publications until retry succeeds", async () => {
  const { container, data, reload } = await mountKnowledgeManager();

  const unpublish = spyOn(
    client,
    "unpublishOrgSharedResource"
  ).mockImplementation(async () => {
    data.sharedResources = data.sharedResources.filter(
      (resource) => resource.resourceKind !== "knowledge"
    );
  });

  cleanups.push(() => unpublish.mockRestore());
  reload.mockRejectedValueOnce(new Error("Overview unavailable"));
  await openKnowledgeManager(container);
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Unpublish parent knowledge"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector("dd")?.textContent).toContain(
    "parent knowledge"
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
      ?.click();
    await settle();
  });
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Retry overview")
      ?.click();
    await settle();
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("dd")?.textContent).not.toContain(
    "parent knowledge"
  );
  expect(unpublish).toHaveBeenCalledTimes(1);
});

function skill(
  id: string,
  name: string,
  orgId: string | null = "parent",
  enabled = true
): SkillSummary {
  return {
    createdAt: "2026-10-12T00:00:00Z",
    createdBy: "human",
    description: "",
    disableModelInvocation: false,
    enabled,
    hasTool: false,
    id,
    name,
    orgId,
    sourcePath: `/private/parent/profile/skills/${id}`,
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

function template(id: string, name: string): ProfileSummary {
  return {
    createdAt: "2026-10-12T00:00:00Z",
    hasAvatar: false,
    id,
    isSuper: false,
    mcpServerCount: 0,
    model: null,
    name,
    soulActive: true,
    toolCount: 0,
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

test.each([
  { id: "skill-a", kind: "skill", label: "skills", name: "Brand voice" },
  { id: "agent-a", kind: "agent", label: "agents", name: "Writer" },
] as const)(
  "parent publication selector uses stable owned IDs in case %#",
  async ({ kind, label, id, name }) => {
    const { container, catalog, data } = await mountKnowledgeManager();

    const skills = spyOn(client, "listSkills").mockResolvedValue({
      skills: [
        skill("skill-a", "Brand voice"),
        skill("skill-b", "Brand voice"),
        skill("skill", "Already published"),
        skill("global", "Global skill", null),
        skill("foreign", "Foreign skill", "other"),
        skill("disabled", "Disabled skill", "parent", false),
      ],
    });

    const profiles = spyOn(client, "listProfiles").mockResolvedValue({
      profiles: [
        template("agent-a", "Writer"),
        template("agent-b", "Writer"),
        template("agent", "Already published"),
        { ...template("default", "Default Bot"), isDefault: true },
        { ...template("super", "Super Nakama"), isSuper: true },
        {
          ...template("instance", "Shared instance"),
          sharedAgent: {
            available: true,
            publicationId: "remote",
            sourceOrgId: "other",
            sourceProfileId: "source",
          },
        },
      ],
    });

    const publication = {
      ...data.sharedResources[0],
      id: `pub-${id}`,
      label: name,
      resourceId: id,
      resourceKind: kind,
    };

    const publish = spyOn(
      client,
      "publishOrgSharedResource"
    ).mockImplementation(async () => {
      data.sharedResources.push(publication);

      return { publication };
    });

    const unpublish = spyOn(
      client,
      "unpublishOrgSharedResource"
    ).mockImplementation(async (_orgId: string, publicationId: string) => {
      data.sharedResources = data.sharedResources.filter(
        (resource) => resource.id !== publicationId
      );
    });

    cleanups.push(() => {
      skills.mockRestore();
      profiles.mockRestore();
      publish.mockRestore();
      unpublish.mockRestore();
    });
    expect(skills).not.toHaveBeenCalled();
    expect(profiles).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Manage shared ${label}"]`
        )
        ?.click();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(catalog).not.toHaveBeenCalled();
    expect(kind === "skill" ? skills.mock.calls : profiles.mock.calls).toEqual([
      ["parent"],
    ]);
    expect(kind === "skill" ? profiles : skills).not.toHaveBeenCalled();
    await selectPublicationResource([`${name} (${id})`, `${name} (${kind}-b)`]);
    expect(
      document.querySelector('[role="dialog"]')?.textContent
    ).not.toContain("/private/");
    await act(async () => {
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button'
        ),
      ]
        .find((button) => button.textContent === `Publish ${kind}`)
        ?.click();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(publish.mock.calls).toEqual([
      ["parent", { resourceId: id, resourceKind: kind }],
    ]);
    expect(
      document.querySelector(`button[aria-label="Unpublish ${name}"]`)
    ).not.toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Unpublish ${name}"]`
        )
        ?.click();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(unpublish.mock.calls).toEqual([["parent", `pub-${id}`]]);
    expect(
      document.querySelector(`button[aria-label="Unpublish ${name}"]`)
    ).toBeNull();
  }
);

test("skill catalog failure permits a scoped retry before publication", async () => {
  const { container } = await mountKnowledgeManager();

  const skills = spyOn(client, "listSkills")
    .mockRejectedValueOnce(new Error("Catalog unavailable"))
    .mockResolvedValue({ skills: [skill("skill-a", "Brand voice")] });

  cleanups.push(() => skills.mockRestore());
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Manage shared skills"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(document.querySelector('[role="combobox"]')).toBeNull();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent === "Retry skills")
      ?.click();
    await settle();
  });
  expect(skills.mock.calls).toEqual([["parent"], ["parent"]]);
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
  await selectPublicationResource(["Brand voice"]);
});

test("team admins cannot load private skill or agent publication catalogs", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    overview("team-a")
  );
  const skills = spyOn(client, "listSkills").mockResolvedValue({ skills: [] });

  const profiles = spyOn(client, "listProfiles").mockResolvedValue({
    profiles: [],
  });

  cleanups.push(() => {
    skills.mockRestore();
    profiles.mockRestore();
  });
  const { container, render } = mount(queries);
  await render({ ...organization("team-a"), role: "admin" });
  expect(
    container.querySelectorAll('button[aria-label^="Manage shared"]')
  ).toHaveLength(0);
  expect(skills).not.toHaveBeenCalled();
  expect(profiles).not.toHaveBeenCalled();
});

test.each([
  { id: "tool-a", kind: "tool", label: "tools", name: "Search" },
  {
    id: "provider-a::model-a",
    kind: "model",
    label: "models",
    name: "Model A",
  },
] as const)(
  "tool and model publication uses catalog IDs in case %#",
  async ({ id, kind, label, name }) => {
    const { container, catalog, data, queries } = await mountKnowledgeManager();
    const publishedId = kind === "tool" ? "tool" : "provider-a::published";
    const secondId = kind === "tool" ? "tool-b" : "provider-b::model-a";
    data.sharedResources = data.sharedResources.map((resource) =>
      resource.resourceKind === kind
        ? { ...resource, resourceId: publishedId }
        : resource
    );
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      structuredClone(data)
    );

    const tools = spyOn(client, "listTools").mockResolvedValue({
      tools: [
        {
          createdAt: "2026-10-12",
          description: "",
          handlerConfig: {},
          handlerType: "builtin",
          id: "tool-a",
          name: "Search",
          updatedAt: "2026-10-12",
        },
        {
          createdAt: "2026-10-12",
          description: "",
          handlerConfig: {},
          handlerType: "builtin",
          id: "tool-b",
          name: "Search",
          updatedAt: "2026-10-12",
        },
        {
          createdAt: "2026-10-12",
          description: "",
          handlerConfig: {},
          handlerType: "builtin",
          id: "tool",
          name: "Published",
          updatedAt: "2026-10-12",
        },
      ],
    });

    const models = spyOn(client, "getModels").mockResolvedValue({
      currentProviderId: "provider-a",
      displayName: null,
      models: [
        {
          id: "model-a",
          name: "Model A",
          provider: "openai",
          providerId: "provider-a",
        },
        {
          id: "model-a",
          name: "Model A",
          provider: "openai",
          providerId: "provider-b",
        },
        {
          id: "published",
          name: "Published",
          provider: "openai",
          providerId: "provider-a",
        },
        {
          id: "missing",
          name: "Missing provider",
          provider: "openai",
          providerId: "removed",
        },
        { id: "unconfigured", name: "Static catalog", provider: "openai" },
      ],
      provider: "openai",
      providers: ["provider-a", "provider-b"].map((providerId) => ({
        createdAt: "2026-10-12",
        hasApiKey: true,
        id: providerId,
        label: providerId,
        modelCount: 2,
        type: "openai" as const,
      })),
    });

    const publication = {
      ...data.sharedResources[0],
      id: `pub-${kind}`,
      label: name,
      resourceId: id,
      resourceKind: kind,
    };

    const publish = spyOn(client, "publishOrgSharedResource")
      .mockRejectedValueOnce(new Error("Publication failed"))
      .mockImplementation(async () => {
        data.sharedResources.push(publication);

        return { publication };
      });

    const unpublish = spyOn(
      client,
      "unpublishOrgSharedResource"
    ).mockImplementation(async (_orgId: string, publicationId: string) => {
      data.sharedResources = data.sharedResources.filter(
        (resource) => resource.id !== publicationId
      );
    });

    cleanups.push(() => {
      tools.mockRestore();
      models.mockRestore();
      publish.mockRestore();
      unpublish.mockRestore();
    });
    expect(tools).not.toHaveBeenCalled();
    expect(models).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Manage shared ${label}"]`
        )
        ?.click();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(catalog).not.toHaveBeenCalled();
    expect(kind === "tool" ? models : tools).not.toHaveBeenCalled();
    expect(kind === "tool" ? tools.mock.calls : models.mock.calls).toEqual(
      kind === "tool" ? [["parent"]] : [[]]
    );
    await selectPublicationResource([
      `${name} (${id})`,
      `${name} (${secondId})`,
    ]);

    const submit = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === `Publish ${kind}`);

    await act(async () => {
      submit?.click();
      await settle();
    });
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')
    ).not.toBeNull();
    expect(document.querySelector('[role="combobox"]')?.textContent).toContain(
      name
    );
    await act(async () => {
      submit?.click();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(publish.mock.calls).toEqual([
      ["parent", { resourceId: id, resourceKind: kind }],
      ["parent", { resourceId: id, resourceKind: kind }],
    ]);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Unpublish ${name}"]`
        )
        ?.click();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(unpublish.mock.calls).toEqual([["parent", `pub-${kind}`]]);
    expect(
      document.querySelector(`button[aria-label="Unpublish ${name}"]`)
    ).toBeNull();
  }
);

function publishedSkill(
  publicationId = "team-a-skill",
  body = "Shared instructions"
) {
  return {
    skill: {
      body,
      createdAt: "2026-10-12T00:00:00Z",
      createdBy: "human" as const,
      description: "Source description",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "source-skill",
      name: "Brand voice",
      publicationId,
      scope: "parent" as const,
      sourceOrganization: { id: "parent", name: "Parent" },
      updatedAt: "2026-10-12T00:00:00Z",
    },
  };
}

async function mountResourceReader(
  role: "admin" | "member" = "member",
  isPlatformAdmin = false
) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  for (const id of ["team-a", "team-b"]) {
    queries.setQueryData(
      queryKeys.organizationOverview("parent", id),
      overview(id)
    );
  }

  const result = mount(queries, undefined, undefined, {
    email: "creator@example.com",
    id: "creator",
    isPlatformAdmin,
  });

  await result.render({ ...organization("team-a"), role });

  return { ...result, queries };
}

async function openSharedSkill(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="View shared skill"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

test.each(["admin", "member"] as const)(
  "shared skill details use active tenant and remain read-only for %s",
  async (role) => {
    const read = spyOn(client, "getPublishedSkill").mockResolvedValue(
      publishedSkill("team-a-skill", '<script>alert("x")</script>')
    );

    const privateRead = spyOn(client, "getSkill");
    cleanups.push(() => {
      read.mockRestore();
      privateRead.mockRestore();
    });
    const { container } = await mountResourceReader(role);
    expect(read).not.toHaveBeenCalled();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="View shared skill"]'
    );

    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await openSharedSkill(container);
    expect(read.mock.calls).toEqual([["team-a", "team-a-skill"]]);
    expect(privateRead).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("pre")?.textContent).toBe(
      '<script>alert("x")</script>'
    );
    expect(dialog?.querySelector("script")).toBeNull();
    expect(dialog?.textContent).toContain("Parent");
    expect(dialog?.querySelectorAll("input,textarea,select")).toHaveLength(0);
    expect(dialog?.querySelectorAll("button")).toHaveLength(1);
  }
);

test("shared skill details retry and recheck publication on reopening", async () => {
  const pending = Promise.withResolvers<ReturnType<typeof publishedSkill>>();

  const read = spyOn(client, "getPublishedSkill")
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(publishedSkill())
    .mockRejectedValueOnce(new Error("Publication removed"));

  cleanups.push(() => read.mockRestore());
  const { container } = await mountResourceReader();
  await openSharedSkill(container);
  expect(
    document.querySelector('[role="dialog"] [role="status"]')
  ).not.toBeNull();
  await act(async () => {
    pending.reject(new Error("Read failed"));
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(document.querySelector('[role="dialog"] pre')).toBeNull();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent === "Retry skill")
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
    "Shared instructions"
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
      ?.click();
    await settle();
  });
  await openSharedSkill(container);
  expect(read.mock.calls).toEqual(
    Array.from({ length: 3 }, () => ["team-a", "team-a-skill"])
  );
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(document.querySelector('[role="dialog"] pre')).toBeNull();
});

test("late shared skill response cannot replace another team's details", async () => {
  const pending = Promise.withResolvers<ReturnType<typeof publishedSkill>>();

  const read = spyOn(client, "getPublishedSkill")
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(publishedSkill("team-b-skill", "Team B content"));

  cleanups.push(() => read.mockRestore());
  const { container, render } = await mountResourceReader();
  await openSharedSkill(container);
  await render({ ...organization("team-b"), role: "member" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openSharedSkill(container);
  await act(async () => {
    pending.resolve(publishedSkill("team-a-skill", "Old team content"));
    await settle();
  });
  expect(read.mock.calls).toEqual([
    ["team-a", "team-a-skill"],
    ["team-b", "team-b-skill"],
  ]);
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
    "Team B content"
  );
  expect(document.body.textContent).not.toContain("Old team content");
});

test.each([
  { dialog: true, link: false, platform: false, role: "admin" },
  { dialog: false, link: false, platform: false, role: "member" },
  { dialog: false, link: true, platform: true, role: "member" },
] as const)(
  "root skill actions keep role gates and published scope %#",
  async ({ dialog, link, platform, role }) => {
    const read = spyOn(client, "getPublishedSkill")
      .mockResolvedValueOnce(
        publishedSkill("root/publication?", "Root instructions")
      )
      .mockRejectedValueOnce(new Error("Publication removed"));

    cleanups.push(() => read.mockRestore());

    const { container, queries, render } = await mountResourceReader(
      role,
      platform
    );

    const data = overview("parent");
    data.sharedResources[1].id = "root/publication?";
    data.sharedResources[1].resourceId = "root/source?";
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );
    await render({ ...organization("parent"), parentOrgId: null, role });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="View shared skill"]'
    );

    expect(Boolean(trigger)).toBe(dialog);
    expect(
      Boolean(container.querySelector('a[aria-label^="View published skill"]'))
    ).toBe(link);
    expect(read).not.toHaveBeenCalled();

    if (!dialog) {
      return;
    }

    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await openSharedSkill(container);
    expect(read.mock.calls[0]).toEqual(["parent", "root/publication?"]);
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      "Root instructions"
    );
    expect(
      document.querySelector(
        '[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select'
      )
    ).toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
        ?.click();
      await settle();
    });
    await openSharedSkill(container);
    expect(read.mock.calls[1]).toEqual(["parent", "root/publication?"]);
    expect(document.querySelector('[role="dialog"] pre')).toBeNull();
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')
    ).not.toBeNull();
  }
);

test.each([
  { owner: "parent", readiness: "unavailable" },
  { owner: "parent", readiness: "requires_setup" },
  { owner: "other", readiness: "ready" },
] as const)(
  "unavailable or foreign root skill cannot open a reader %#",
  async ({ owner, readiness }) => {
    const read = spyOn(client, "getPublishedSkill");
    cleanups.push(() => read.mockRestore());
    const { container, queries, render } = await mountResourceReader("admin");
    const data = overview("parent");
    data.sharedResources[1].orgId = owner;
    data.sharedResources[1].readiness = readiness;
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );
    await render({
      ...organization("parent"),
      parentOrgId: null,
      role: "admin",
    });
    expect(
      container.querySelector('button[aria-label^="View shared skill"]')
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  }
);

test("unavailable shared skills remain non-actionable", async () => {
  const { container, queries } = await mountResourceReader();
  const data = overview("team-a");
  data.sharedResources[1].readiness = "unavailable";
  await act(async () => {
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "team-a"),
      data
    );
    await settle();
  });
  expect(
    container.querySelector('button[aria-label^="View shared skill"]')
  ).toBeNull();
  expect(container.textContent).toContain(data.sharedResources[1].label);
});

function publishedDocument(body = "Shared document") {
  return {
    contentType: "text/plain; charset=utf-8",
    data: new TextEncoder().encode(body).buffer,
  };
}

async function openSharedKnowledge(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="View shared knowledge"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

async function downloadSharedKnowledge() {
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-footer"] button')
      ?.click();
    await settle();
  });
}

function observeDocumentDownloads() {
  const downloads: Array<{ filename: string; url: string }> = [];

  const createUrl = spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:published-document"
  );

  const revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(
    () => undefined
  );

  const click = spyOn(
    window.HTMLAnchorElement.prototype,
    "click"
  ).mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, url: this.href });
  });

  cleanups.push(() => {
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    click.mockRestore();
  });

  return { click, createUrl, downloads, revokeUrl };
}

test.each(["admin", "member"] as const)(
  "shared knowledge preview and download use active tenant for %s",
  async (role) => {
    const original = {
      contentType: "application/pdf",
      data: new Uint8Array([0, 255, 128, 1]).buffer,
    };

    const read = spyOn(client, "readPublishedKnowledgeBaseDocument")
      .mockResolvedValueOnce(publishedDocument('<script>alert("x")</script>'))
      .mockResolvedValueOnce(original);

    cleanups.push(() => read.mockRestore());
    const { createUrl, revokeUrl, downloads } = observeDocumentDownloads();
    const { container } = await mountResourceReader(role);
    expect(read).not.toHaveBeenCalled();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="View shared knowledge"]'
    );

    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await openSharedKnowledge(container);
    expect(read.mock.calls).toEqual([
      ["team-a", "team-a-knowledge", { render: "text" }],
    ]);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("pre")?.textContent).toBe(
      '<script>alert("x")</script>'
    );
    expect(dialog?.querySelector("script")).toBeNull();
    expect(dialog?.querySelectorAll("input,textarea,select")).toHaveLength(0);
    await downloadSharedKnowledge();
    expect(read.mock.calls[1]).toEqual(["team-a", "team-a-knowledge"]);
    expect(downloads).toEqual([
      { filename: "team-a knowledge", url: "blob:published-document" },
    ]);
    const blob = createUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);

    if (!(blob instanceof Blob)) {
      throw new Error("Expected downloaded document bytes");
    }

    expect(blob.type).toBe(original.contentType);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array(original.data)
    );
    expect(revokeUrl.mock.calls).toEqual([["blob:published-document"]]);
    expect(document.querySelector("a[download]")).toBeNull();
  }
);

test.each([
  { actionable: true, platform: false, role: "admin" },
  { actionable: false, platform: false, role: "member" },
  { actionable: true, platform: true, role: "member" },
] as const)(
  "root knowledge actions use parent context and existing permissions %#",
  async ({ actionable, platform, role }) => {
    const read = spyOn(client, "readPublishedKnowledgeBaseDocument")
      .mockResolvedValueOnce(publishedDocument("Root preview"))
      .mockResolvedValueOnce(publishedDocument("Root original"))
      .mockRejectedValue(new Error("Publication removed"));

    cleanups.push(() => read.mockRestore());
    const { downloads, revokeUrl } = observeDocumentDownloads();

    const { container, queries, render } = await mountResourceReader(
      role,
      platform
    );

    const data = overview("parent");
    data.sharedResources[0].id = "root/publication?";
    data.sharedResources[0].resourceId = "root/document?";
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );
    await render({ ...organization("parent"), parentOrgId: null, role });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="View shared knowledge"]'
    );

    expect(Boolean(trigger)).toBe(actionable);
    expect(read).not.toHaveBeenCalled();

    if (!actionable) {
      return;
    }

    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await openSharedKnowledge(container);
    expect(read.mock.calls).toEqual([
      ["parent", "root/publication?", { render: "text" }],
    ]);
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      "Root preview"
    );
    await downloadSharedKnowledge();
    expect(read.mock.calls[1]).toEqual(["parent", "root/publication?"]);
    expect(downloads).toEqual([
      { filename: "parent knowledge", url: "blob:published-document" },
    ]);
    expect(revokeUrl.mock.calls).toEqual([["blob:published-document"]]);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
        ?.click();
      await settle();
    });
    await openSharedKnowledge(container);
    expect(read.mock.calls[2]).toEqual([
      "parent",
      "root/publication?",
      { render: "text" },
    ]);
    expect(document.querySelector('[role="dialog"] pre')).toBeNull();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await downloadSharedKnowledge();
    expect(read.mock.calls[3]).toEqual(["parent", "root/publication?"]);
    expect(downloads).toHaveLength(1);
  }
);

test.each([
  { owner: "parent", readiness: "unavailable" },
  { owner: "parent", readiness: "requires_setup" },
  { owner: "other", readiness: "ready" },
] as const)(
  "unavailable or foreign root knowledge remains static %#",
  async ({ owner, readiness }) => {
    const read = spyOn(client, "readPublishedKnowledgeBaseDocument");
    cleanups.push(() => read.mockRestore());
    const { container, queries, render } = await mountResourceReader("admin");
    const data = overview("parent");
    data.sharedResources[0].orgId = owner;
    data.sharedResources[0].readiness = readiness;
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );
    await render({
      ...organization("parent"),
      parentOrgId: null,
      role: "admin",
    });
    expect(
      container.querySelector('button[aria-label^="View shared knowledge"]')
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  }
);

test("late root knowledge preview cannot appear after selecting a team", async () => {
  const pending =
    Promise.withResolvers<
      Awaited<ReturnType<typeof client.readPublishedKnowledgeBaseDocument>>
    >();

  const read = spyOn(client, "readPublishedKnowledgeBaseDocument")
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(publishedDocument("Team preview"));

  cleanups.push(() => read.mockRestore());
  const { container, queries, render } = await mountResourceReader("admin");
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    overview("parent")
  );
  await render({ ...organization("parent"), parentOrgId: null, role: "admin" });
  await openSharedKnowledge(container);
  expect(read.mock.calls[0]).toEqual([
    "parent",
    "parent-knowledge",
    { render: "text" },
  ]);
  await render({ ...organization("team-a"), role: "admin" });
  await act(async () => {
    pending.resolve(publishedDocument("Private root preview"));
    await settle();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Private root preview");
  await openSharedKnowledge(container);
  expect(read.mock.calls[1]).toEqual([
    "team-a",
    "team-a-knowledge",
    { render: "text" },
  ]);
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
    "Team preview"
  );
});

test("shared knowledge preview retries and hides cached bytes after publication removal", async () => {
  const pending = Promise.withResolvers<ReturnType<typeof publishedDocument>>();

  const read = spyOn(client, "readPublishedKnowledgeBaseDocument")
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(publishedDocument())
    .mockRejectedValueOnce(new Error("Publication removed"));

  cleanups.push(() => read.mockRestore());
  const { container } = await mountResourceReader();
  await openSharedKnowledge(container);
  expect(
    document.querySelector('[role="dialog"] [role="status"]')
  ).not.toBeNull();
  await act(async () => {
    pending.reject(new Error("Preview failed"));
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent === "Retry preview")
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
    "Shared document"
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
      ?.click();
    await settle();
  });
  await openSharedKnowledge(container);
  expect(read.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [
      "team-a",
      "team-a-knowledge",
      { render: "text" },
    ])
  );
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(document.querySelector('[role="dialog"] pre')).toBeNull();
});

test("failed download can retry without using preview bytes", async () => {
  const read = spyOn(client, "readPublishedKnowledgeBaseDocument")
    .mockResolvedValueOnce(publishedDocument("Extracted preview"))
    .mockRejectedValueOnce(new Error("Download denied"))
    .mockResolvedValueOnce(publishedDocument("Original content"));

  cleanups.push(() => read.mockRestore());
  const { createUrl, downloads } = observeDocumentDownloads();
  const { container } = await mountResourceReader();
  await openSharedKnowledge(container);
  await downloadSharedKnowledge();
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(downloads).toHaveLength(0);
  await downloadSharedKnowledge();
  expect(read.mock.calls).toEqual([
    ["team-a", "team-a-knowledge", { render: "text" }],
    ["team-a", "team-a-knowledge"],
    ["team-a", "team-a-knowledge"],
  ]);
  expect(downloads).toHaveLength(1);
  const blob = createUrl.mock.calls[0]?.[0];

  if (!(blob instanceof Blob)) {
    throw new Error("Expected downloaded document bytes");
  }

  expect(await blob.text()).toBe("Original content");
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
});

test.each(["preview", "download"] as const)(
  "late shared knowledge %s cannot act in another team",
  async (action) => {
    const pending =
      Promise.withResolvers<ReturnType<typeof publishedDocument>>();

    const read = spyOn(client, "readPublishedKnowledgeBaseDocument");

    if (action === "download") {
      read.mockResolvedValueOnce(publishedDocument());
    }

    read
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(publishedDocument("Team B content"));
    cleanups.push(() => read.mockRestore());
    const { downloads, createUrl } = observeDocumentDownloads();
    const { container, render } = await mountResourceReader();
    await openSharedKnowledge(container);

    if (action === "download") {
      await act(async () => {
        const submit = document.querySelector<HTMLButtonElement>(
          '[data-slot="dialog-footer"] button'
        );

        submit?.click();
        submit?.click();
        await settle();
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-slot="dialog-footer"] button'
        )?.disabled
      ).toBe(true);
    }

    await render({ ...organization("team-b"), role: "member" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await openSharedKnowledge(container);
    await act(async () => {
      pending.resolve(publishedDocument("Old team content"));
      await settle();
    });
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      "Team B content"
    );
    expect(document.body.textContent).not.toContain("Old team content");
    expect(downloads).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
  }
);

test("unavailable shared knowledge stays non-actionable", async () => {
  const { container, queries } = await mountResourceReader();
  const data = overview("team-a");
  data.sharedResources[0].readiness = "unavailable";
  await act(async () => {
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "team-a"),
      data
    );
    await settle();
  });
  expect(
    container.querySelector('button[aria-label^="View shared knowledge"]')
  ).toBeNull();
  expect(container.textContent).toContain(data.sharedResources[0].label);
});

test("failed download activation releases original bytes and allows another attempt", async () => {
  const read = spyOn(
    client,
    "readPublishedKnowledgeBaseDocument"
  ).mockResolvedValue(publishedDocument());

  cleanups.push(() => read.mockRestore());
  const { revokeUrl, downloads, click } = observeDocumentDownloads();
  click.mockImplementationOnce(() => {
    throw new Error("Download activation failed");
  });
  const { container } = await mountResourceReader();
  await openSharedKnowledge(container);
  await downloadSharedKnowledge();
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(
    document.querySelector<HTMLButtonElement>(
      '[data-slot="dialog-footer"] button'
    )?.disabled
  ).toBe(false);
  expect(revokeUrl.mock.calls).toEqual([["blob:published-document"]]);
  expect(document.querySelector("a[download]")).toBeNull();
  await downloadSharedKnowledge();
  expect(downloads).toHaveLength(1);
  expect(revokeUrl.mock.calls).toEqual([
    ["blob:published-document"],
    ["blob:published-document"],
  ]);
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
});

function sharedAgentInstance(): ProfileResponse {
  return {
    profile: {
      ...template("team-instance", "Team writer"),
      mcpServers: [],
      sharedAgent: {
        available: true,
        publicationId: "team-a-agent",
        sourceOrgId: "parent",
        sourceProfileId: "agent",
      },
      skills: [],
      systemPrompt: "",
      tools: [],
    },
  };
}

function observeSoulEditor(shared: boolean, available = true) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const profile = sharedAgentInstance().profile;

  if (shared) {
    profile.sharedAgent!.available = available;
  } else {
    delete profile.sharedAgent;
  }

  const status: SoulStatusResponse = {
    active: true,
    contents: {
      instructions: "Team instructions",
      memory: "Team memory",
      soul: "Team identity",
      style: "Team style",
    },
    directory: "/team/workspace",
    files: {
      examples: false,
      instructions: true,
      memory: true,
      soul: true,
      style: true,
    },
    profileId: profile.id,
  };

  queries.setQueryData(queryKeys.profiles.all, [profile]);
  queries.setQueryData(queryKeys.soul.profile(profile.id), status);
  const reads = spyOn(client, "getProfileSoulStatus").mockResolvedValue(status);

  const profiles = spyOn(client, "listProfiles").mockResolvedValue({
    profiles: [profile],
  });

  const write = spyOn(client, "writeProfileSoulFile").mockResolvedValue(
    undefined
  );

  cleanups.push(() => {
    reads.mockRestore();
    profiles.mockRestore();
    write.mockRestore();
  });

  return {
    ...mount(
      queries,
      undefined,
      undefined,
      { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
      <SoulTab profileId={profile.id} />
    ),
    profile,
    queries,
    reads,
    status,
    write,
  };
}

for (const scenario of [
  { available: true, shared: true },
  { available: false, shared: true },
  { available: true, shared: false },
]) {
  for (const file of SOUL_FILES) {
    test(`soul ${file.key} follows ownership ${JSON.stringify(scenario)}`, async () => {
      const { container, render, profile, reads, status, write } =
        observeSoulEditor(scenario.shared, scenario.available);

      await render({ ...organization("team-a"), role: "admin" });

      const trigger = [
        ...container.querySelectorAll<HTMLButtonElement>("li button"),
      ].find(
        (button) => button.querySelector("p")?.textContent === file.label
      )!;

      await act(async () => {
        trigger.click();
        await settle();
      });
      await act(async () => {
        await settle();
      });
      expect(reads).toHaveBeenCalledWith(profile.id, { includeContents: true });

      const editor = document.querySelector<HTMLTextAreaElement>(
        '[role="dialog"] textarea'
      )!;

      const writable = !scenario.shared || file.key === "memory";
      expect(editor.readOnly).toBe(!writable);
      expect(editor.value).toBe(status.contents?.[file.key] ?? "");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(editor),
          "value"
        )?.set?.call(editor, "Changed team file");
        editor.dispatchEvent(new window.Event("input", { bubbles: true }));
      });

      const save = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button'
        ),
      ].find((button) => button.textContent === "Save file");

      if (writable) {
        expect(save).toBeDefined();
        expect(save!.disabled).toBe(false);
        await act(async () => {
          save!.click();
          await settle();
        });
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(
          profile.id,
          file.key,
          "Changed team file"
        );
      } else {
        expect(save).toBeUndefined();
        expect(write).not.toHaveBeenCalled();
      }
    });
  }
}

test("soul editing waits for profile ownership and rechecks an open dialog", async () => {
  const { container, render, profile, queries, write } =
    observeSoulEditor(false);

  queries.setQueryData(queryKeys.profiles.all, []);
  await render({ ...organization("team-a"), role: "admin" });
  await act(async () => {
    container.querySelector<HTMLButtonElement>("li button")!.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });

  const editor = document.querySelector<HTMLTextAreaElement>(
    '[role="dialog"] textarea'
  )!;

  expect(editor.readOnly).toBe(true);
  await act(async () => {
    queries.setQueryData(queryKeys.profiles.all, [profile]);
    await settle();
  });
  expect(editor.readOnly).toBe(false);
  await act(async () => {
    queries.setQueryData(queryKeys.profiles.all, [
      { ...profile, sharedAgent: sharedAgentInstance().profile.sharedAgent },
    ]);
    await settle();
  });
  expect(editor.readOnly).toBe(true);
  expect(
    [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].some((button) => button.textContent === "Save file")
  ).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

function ProfileActionsProbe() {
  const state = useProfilesPage();

  return (
    <>
      <ProfileConfigTab state={state} />
      <ProfilesDialogs {...state} />
      <button
        onClick={() =>
          state.selectedId && state.openCloneDialog(state.selectedId)
        }
        type="button"
      >
        Attempt clone
      </button>
      <button onClick={() => void state.handleCloneConfirm()} type="button">
        Attempt clone confirmation
      </button>
    </>
  );
}

function observeProfileActions(
  shared: boolean,
  available = true,
  platformAdmin = true,
  content: ReactNode = <ProfileActionsProbe />
) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: false,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  const profile = sharedAgentInstance().profile;

  if (shared) {
    profile.sharedAgent!.available = available;
  } else {
    delete profile.sharedAgent;
  }

  queries.setQueryData(queryKeys.profiles.all, [profile]);
  queries.setQueryData(queryKeys.profiles.detail(profile.id), profile);
  queries.setQueryData(queryKeys.composio.profileToolkits(profile.id), {
    assignments: [],
  });
  queries.setQueryData(queryKeys.soul.profile(profile.id), {
    active: false,
    directory: "/team/workspace",
    files: {
      examples: false,
      instructions: false,
      memory: false,
      soul: false,
      style: false,
    },
  } satisfies SoulStatusResponse);

  const clone = spyOn(client, "cloneProfile").mockRejectedValue(
    new Error("Retry clone")
  );

  const move = spyOn(client, "moveProfile");

  const destinations = spyOn(
    client,
    "listPlatformOrganizations"
  ).mockResolvedValue({ organizations: [organization("other")] });

  cleanups.push(() => {
    clone.mockRestore();
    move.mockRestore();
    destinations.mockRestore();
  });

  return {
    ...mount(
      queries,
      undefined,
      undefined,
      {
        email: "admin@example.com",
        id: "admin",
        isPlatformAdmin: platformAdmin,
      },
      content
    ),
    clone,
    destinations,
    move,
    profile,
    queries,
  };
}

test.each([
  { available: true, platformAdmin: true, shared: true },
  { available: false, platformAdmin: true, shared: true },
  { available: true, platformAdmin: false, shared: true },
  { available: true, platformAdmin: false, shared: false },
  { available: true, platformAdmin: true, shared: false },
])(
  "profile actions retain permissions and shared ownership %j",
  async (scenario) => {
    const { container, render, clone, move, destinations, profile } =
      observeProfileActions(
        scenario.shared,
        scenario.available,
        scenario.platformAdmin
      );

    await render({ ...organization("team-a"), role: "admin" });

    const actions = [
      ...container.querySelectorAll<HTMLButtonElement>("footer button"),
    ];

    const duplicate = actions.find(
      (button) => button.textContent === "Duplicate"
    );

    const transfer = actions.find(
      (button) => button.textContent === "Move agent"
    );

    expect(Boolean(duplicate)).toBe(scenario.platformAdmin && !scenario.shared);
    expect(Boolean(transfer)).toBe(scenario.platformAdmin && !scenario.shared);
    expect(
      actions.some((button) => button.textContent === "Import agent")
    ).toBe(true);
    expect(
      actions.some((button) => button.textContent === "Export agent")
    ).toBe(true);
    expect(
      actions.some((button) => button.textContent === "Delete agent")
    ).toBe(scenario.platformAdmin);

    const attempt = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Attempt clone")!;

    await act(async () => {
      attempt.click();
      await settle();
    });

    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === "Clone");

    if (scenario.platformAdmin && !scenario.shared) {
      expect(confirm).toBeDefined();
      await act(async () => {
        confirm!.click();
        await settle();
      });
      expect(clone).toHaveBeenCalledWith(profile.id);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => {
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[role="dialog"] button'
          ),
        ]
          .find((button) => button.textContent === "Cancel")!
          .click();
        await settle();
      });
      await act(async () => {
        transfer!.click();
        await settle();
      });
      expect(destinations).toHaveBeenCalledTimes(1);
      expect(
        document.querySelector('[aria-label="Destination organization"]')
      ).not.toBeNull();
    } else {
      expect(confirm).toBeUndefined();
      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>("button")]
          .find(
            (button) => button.textContent === "Attempt clone confirmation"
          )!
          .click();
        await settle();
      });
      expect(clone).not.toHaveBeenCalled();
      expect(destinations).not.toHaveBeenCalled();
    }

    expect(move).not.toHaveBeenCalled();
  }
);

for (const action of ["Duplicate", "Move agent"] as const) {
  test(`${action} dialog closes when its local profile becomes shared`, async () => {
    const { container, render, profile, queries, clone, move } =
      observeProfileActions(false);

    await render({ ...organization("team-a"), role: "admin" });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("footer button")]
        .find((button) => button.textContent === action)!
        .click();
      await settle();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      const shared = {
        ...profile,
        sharedAgent: sharedAgentInstance().profile.sharedAgent,
      };

      queries.setQueryData(queryKeys.profiles.all, [shared]);
      queries.setQueryData(queryKeys.profiles.detail(profile.id), shared);
      await settle();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Attempt clone confirmation")!
        .click();
      await settle();
    });
    expect(clone).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });
}

function ProfileAssignmentsProbe({
  capture,
}: {
  capture: (state: ReturnType<typeof useProfilesPage>) => void;
}) {
  const state = useProfilesPage();
  useEffect(() => {
    capture(state);
  }, [capture, state]);

  return <ProfilesDialogs {...state} />;
}

test.each([
  { available: true, platformAdmin: true, shared: true },
  { available: false, platformAdmin: true, shared: true },
  { available: true, platformAdmin: false, shared: true },
  { available: true, platformAdmin: false, shared: false },
  { available: true, platformAdmin: true, shared: false },
])(
  "assignment handlers check current ownership and authority %j",
  async (scenario) => {
    let state!: ReturnType<typeof useProfilesPage>;

    const { render, profile, queries } = observeProfileActions(
      scenario.shared,
      scenario.available,
      scenario.platformAdmin,
      <ProfileAssignmentsProbe
        capture={(next) => {
          state = next;
        }}
      />
    );

    queries.setQueryData(queryKeys.skills.all, [skill("skill", "Local skill")]);

    const assignTool = spyOn(client, "assignTool").mockResolvedValue({
      profile,
    });

    const assignSkill = spyOn(client, "assignSkill").mockResolvedValue({
      profile,
    });

    const assignMcp = spyOn(client, "assignMcpServer").mockResolvedValue({
      profile,
    });

    const unassignTool = spyOn(client, "unassignTool").mockResolvedValue({
      profile,
    });

    const unassignSkill = spyOn(client, "unassignSkill").mockResolvedValue({
      profile,
    });

    const unassignMcp = spyOn(client, "unassignMcpServer").mockResolvedValue({
      profile,
    });

    const composio = spyOn(
      client,
      "updateProfileComposioToolkits"
    ).mockResolvedValue({ assignments: [] });

    const createSkill = spyOn(client, "createSkill").mockRejectedValue(
      new Error("Retry creation")
    );

    const installSkill = spyOn(client, "installSkill").mockRejectedValue(
      new Error("Retry installation")
    );

    const createMcp = spyOn(client, "createMcpServer").mockRejectedValue(
      new Error("Retry creation")
    );

    const deleteSkill = spyOn(client, "deleteSkill").mockResolvedValue(
      undefined
    );

    const requests = [
      assignTool,
      assignSkill,
      assignMcp,
      unassignTool,
      unassignSkill,
      unassignMcp,
      composio,
      createSkill,
      installSkill,
      createMcp,
      deleteSkill,
    ];

    cleanups.push(() => {
      for (const request of requests) {
        request.mockRestore();
      }
    });
    await render({ ...organization("team-a"), role: "admin" });

    for (const attempt of [
      () => state.handleAssignTool("tool"),
      () => state.handleAssignBash(),
      () => state.handleAssignSkill("skill"),
      () => state.handleAssignMcpServer("mcp"),
      () => state.handleAssignComposioToolkit("app"),
      () =>
        state.handleCreateSkill({
          description: "Test",
          name: "Created",
          profileId: profile.id,
        }),
      () =>
        state.handleInstallSkill({
          profileId: profile.id,
          url: "https://example.com/skill",
        }),
      () =>
        state.handleCreateMcpServer({
          config: { command: "server" },
          name: "Created",
          transport: "stdio",
        }),
      () => state.handleDeleteSkill("skill"),
    ]) {
      await act(async () => {
        await attempt().catch(() => undefined);
        await settle();
      });
    }

    for (const kind of ["tool", "skill", "mcp", "composio"] as const) {
      await act(async () => {
        state.setRemoveConfirm({
          id: kind === "composio" ? "app" : kind,
          kind,
          name: kind,
        });
        await settle();
      });
      await act(async () => {
        await state.handleRemoveAssignmentConfirm();
        await settle();
      });
    }

    if (scenario.shared || !scenario.platformAdmin) {
      for (const request of requests) {
        expect(request).not.toHaveBeenCalled();
      }

      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } else {
      expect(assignTool).toHaveBeenCalledWith(profile.id, { toolId: "tool" });
      expect(assignTool).toHaveBeenCalledTimes(2);
      expect(assignSkill).toHaveBeenCalledWith(profile.id, {
        skillId: "skill",
      });
      expect(assignMcp).toHaveBeenCalledWith(profile.id, { serverId: "mcp" });
      expect(composio).toHaveBeenCalledWith(profile.id, {
        assignments: [{ toolkitId: "app" }],
      });
      expect(composio).toHaveBeenCalledWith(profile.id, { assignments: [] });
      expect(unassignTool).toHaveBeenCalledWith(profile.id, "tool");
      expect(unassignSkill).toHaveBeenCalledWith(profile.id, "skill");
      expect(unassignMcp).toHaveBeenCalledWith(profile.id, "mcp");

      for (const request of [
        createSkill,
        installSkill,
        createMcp,
        deleteSkill,
      ]) {
        expect(request).toHaveBeenCalledTimes(1);
      }
    }
  }
);

for (const dialog of [
  "skill-create",
  "skill-install",
  "mcp",
  "remove",
] as const) {
  test(`${dialog} assignment dialog closes after shared ownership changes`, async () => {
    let state!: ReturnType<typeof useProfilesPage>;

    const { render, profile, queries } = observeProfileActions(
      false,
      true,
      true,
      <ProfileAssignmentsProbe
        capture={(next) => {
          state = next;
        }}
      />
    );

    const unassign = spyOn(client, "unassignTool").mockResolvedValue({
      profile,
    });

    const assign = spyOn(client, "assignTool").mockResolvedValue({ profile });
    cleanups.push(() => {
      unassign.mockRestore();
      assign.mockRestore();
    });
    await render({ ...organization("team-a"), role: "admin" });
    await act(async () => {
      if (dialog === "skill-create") {
        state.setSkillCreateOpen(true);
      } else if (dialog === "skill-install") {
        state.setSkillInstallOpen(true);
      } else if (dialog === "mcp") {
        state.setMcpCreateOpen(true);
      } else {
        state.setRemoveConfirm({ id: "tool", kind: "tool", name: "Tool" });
      }

      await settle();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      const shared = {
        ...profile,
        sharedAgent: sharedAgentInstance().profile.sharedAgent,
      };

      queries.setQueryData(queryKeys.profiles.all, [shared]);
      queries.setQueryData(queryKeys.profiles.detail(profile.id), shared);
      await settle();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await state.handleAssignTool("tool");
      await state.handleRemoveAssignmentConfirm();
      await settle();
    });
    expect(assign).not.toHaveBeenCalled();
    expect(unassign).not.toHaveBeenCalled();
  });
}

function ProfileBehaviorProbe() {
  const state = useProfilesPage();

  if (!state.detail) {
    return null;
  }

  return (
    <>
      <div data-profile-behavior>
        <ProfileSkillsSettingsSection profile={state.detail} />
      </div>
      <div data-org-profile-behavior>
        {(
          [
            "skillsWriteApproval",
            "skillsPostTurnReview",
            "skillsCuratorConsolidateEnabled",
          ] as const
        ).map((field) => (
          <OrgSettingsProfileBooleanOverrideField
            field={field}
            key={field}
            profiles={[state.detail!]}
            savedToast="Saved"
          />
        ))}
      </div>
    </>
  );
}

test.each([
  { available: true, platformAdmin: true, shared: true },
  { available: false, platformAdmin: true, shared: true },
  { available: true, platformAdmin: false, shared: true },
  { available: true, platformAdmin: false, shared: false },
])("behavior controls respect shared ownership %j", async (scenario) => {
  const { container, render, profile } = observeProfileActions(
    scenario.shared,
    scenario.available,
    scenario.platformAdmin,
    <ProfileBehaviorProbe />
  );

  profile.skillsWriteApproval = true;
  profile.skillsPostTurnReview = true;
  profile.skillsCuratorConsolidateEnabled = true;
  const update = spyOn(client, "updateProfile").mockResolvedValue({ profile });
  cleanups.push(() => update.mockRestore());

  await render({ ...organization("team-a"), role: "admin" });

  const switches = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
  ];

  const reset = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].filter((button) => button.textContent === "Use org default");

  expect(switches).toHaveLength(7);
  expect(reset).toHaveLength(6);

  for (const control of [...switches, ...reset]) {
    expect(control.disabled).toBe(scenario.shared);
  }

  for (const control of switches) {
    await act(async () => {
      control.click();
      await settle();
    });
  }

  if (scenario.shared) {
    for (const control of reset) {
      await act(async () => control.click());
    }

    expect(update).not.toHaveBeenCalled();
  } else {
    expect(update).toHaveBeenCalledTimes(7);

    for (const field of [
      "automationsEnabled",
      "skillsWriteApproval",
      "skillsPostTurnReview",
      "skillsCuratorConsolidateEnabled",
    ]) {
      expect(update).toHaveBeenCalledWith(profile.id, { [field]: false });
    }

    for (const control of reset) {
      await act(async () => {
        control.click();
        await settle();
      });
    }

    expect(update).toHaveBeenCalledTimes(13);

    for (const field of [
      "skillsWriteApproval",
      "skillsPostTurnReview",
      "skillsCuratorConsolidateEnabled",
    ]) {
      expect(update).toHaveBeenCalledWith(profile.id, { [field]: null });
    }
  }
});

test("open behavior controls become read-only when ownership changes", async () => {
  const { container, render, profile, queries } = observeProfileActions(
    false,
    true,
    true,
    <ProfileBehaviorProbe />
  );

  const update = spyOn(client, "updateProfile").mockResolvedValue({ profile });
  cleanups.push(() => update.mockRestore());
  await render({ ...organization("team-a"), role: "admin" });
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].every(
      (control) => !control.disabled
    )
  ).toBe(true);
  await act(async () => {
    const shared = {
      ...profile,
      sharedAgent: sharedAgentInstance().profile.sharedAgent,
    };

    queries.setQueryData(queryKeys.profiles.all, [shared]);
    queries.setQueryData(queryKeys.profiles.detail(profile.id), shared);
    await settle();
  });

  const controls = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
  ];

  expect(controls).toHaveLength(7);

  for (const control of controls) {
    expect(control.disabled).toBe(true);
    await act(async () => control.click());
  }

  expect(update).not.toHaveBeenCalled();
});

function ProfileIdentityProbe() {
  const state = useProfilesPage();

  return (
    <>
      <ProfileConfigIdentitySection state={state} />
      <ProfileSystemPromptCard state={state} />
      <button
        onClick={async () => {
          state.handleEditNameChange("Changed name");
          state.handleEditPromptChange("Changed prompt");
          state.handleEditModelChange("provider-a::same-model");
          await state.flushSave();
        }}
        type="button"
      >
        Attempt identity save
      </button>
      <button
        onClick={async () => {
          await state.handleEditAcpAgent("");
          await state.handleAvatarRemove();
        }}
        type="button"
      >
        Attempt identity actions
      </button>
    </>
  );
}

test.each([
  { available: true, platformAdmin: true, shared: true },
  { available: false, platformAdmin: true, shared: true },
  { available: true, platformAdmin: false, shared: false },
  { available: true, platformAdmin: true, shared: false },
])(
  "profile identity controls follow template ownership %j",
  async (scenario) => {
    const queries = new QueryClient({
      defaultOptions: {
        queries: {
          enabled: false,
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });

    const response = sharedAgentInstance();

    if (scenario.shared) {
      response.profile.sharedAgent!.available = scenario.available;
    } else {
      delete response.profile.sharedAgent;
    }

    response.profile.systemPrompt = "Original prompt";
    queries.setQueryData(queryKeys.profiles.all, [response.profile]);
    queries.setQueryData(
      queryKeys.profiles.detail(response.profile.id),
      response.profile
    );
    queries.setQueryData(queryKeys.models, configuredSharedModels());
    queries.setQueryData(
      queryKeys.composio.profileToolkits(response.profile.id),
      {
        assignments: [],
      }
    );
    const update = spyOn(client, "updateProfile").mockResolvedValue(response);

    const avatar = spyOn(client, "deleteProfileAvatar").mockResolvedValue(
      undefined
    );

    const profileRead = spyOn(client, "getProfile").mockResolvedValue(response);

    const profilesRead = spyOn(client, "listProfiles").mockResolvedValue({
      profiles: [response.profile],
    });

    cleanups.push(() => {
      update.mockRestore();
      avatar.mockRestore();
      profileRead.mockRestore();
      profilesRead.mockRestore();
    });

    const { container, render } = mount(
      queries,
      undefined,
      undefined,
      {
        email: "admin@example.com",
        id: "admin",
        isPlatformAdmin: scenario.platformAdmin,
      },
      <ProfileIdentityProbe />
    );

    await render({ ...organization("team-a"), role: "admin" });
    const readOnly = scenario.shared || !scenario.platformAdmin;

    const name = container.querySelector<HTMLInputElement>(
      'input[aria-label="Name"]'
    )!;

    const prompt = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit system prompt"]'
    )!;

    expect(name.disabled).toBe(readOnly);
    expect(name.readOnly).toBe(readOnly);
    expect(prompt.disabled).toBe(readOnly);
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled
    ).toBe(readOnly);
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Select model"]'
      )?.disabled
    ).toBe(readOnly);
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Chat agent"]'
      )?.disabled
    ).toBe(readOnly);
    expect(name.value).toBe(response.profile.name);
    expect(prompt.textContent).toBe(response.profile.systemPrompt);

    const actions = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ];

    await act(async () => {
      actions
        .find((button) => button.textContent === "Attempt identity save")!
        .click();
      await settle();
    });

    if (readOnly) {
      await act(async () => {
        actions
          .find((button) => button.textContent === "Attempt identity actions")!
          .click();
        await settle();
      });
      expect(update).not.toHaveBeenCalled();
      expect(avatar).not.toHaveBeenCalled();
      expect(name.value).toBe(response.profile.name);
      expect(prompt.textContent).toBe(response.profile.systemPrompt);
    } else {
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(response.profile.id, {
        model: "provider-a::same-model",
        name: "Changed name",
        systemPrompt: "Changed prompt",
      });
    }
  }
);

function observeAgentSelection() {
  const state = useActiveChatProfileStore.getState();
  useActiveChatProfileStore.setState({
    orgId: "team-a",
    profileId: "old-profile",
  });

  const create = spyOn(client, "createSharedAgentInstance").mockResolvedValue(
    sharedAgentInstance()
  );

  const list = spyOn(client, "listProfiles").mockResolvedValue({
    profiles: [sharedAgentInstance().profile],
  });

  const reload = spyOn(client, "getOrganizationOverview").mockImplementation(
    async (orgId) => overview(orgId)
  );

  cleanups.push(() => {
    create.mockRestore();
    list.mockRestore();
    reload.mockRestore();
    act(() => useActiveChatProfileStore.setState(state));
  });

  return { create, list };
}

async function selectSharedAgent(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Open shared agent"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

test.each(["admin", "member"] as const)(
  "%s selects a team instance after refreshing its profiles",
  async (role) => {
    const { create, list } = observeAgentSelection();
    const { container, queries } = await mountResourceReader(role);
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    await selectSharedAgent(container);
    expect(create).toHaveBeenCalledWith("team-a", "team-a-agent");
    expect(list).toHaveBeenCalledWith("team-a");
    expect(
      queries.getQueryData<ProfileSummary[]>(queryKeys.profiles.all)
    ).toEqual([sharedAgentInstance().profile]);
    expect(
      queries.getQueryData<ProfileSummary[]>([
        ...queryKeys.profiles.all,
        "team-a",
      ])
    ).toEqual([sharedAgentInstance().profile]);
    expect(useActiveChatProfileStore.getState().profileId).toBe(
      "team-instance"
    );
    expect(useActiveChatProfileStore.getState().orgId).toBe("team-a");
    expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
      "/chat?new=1&profile=team-instance"
    );
  }
);

test("agent creation failure retains the selection and permits retry", async () => {
  const { create, list } = observeAgentSelection();
  create.mockRejectedValueOnce(new Error("Selection denied"));
  const { container, queries } = await mountResourceReader();
  await selectSharedAgent(container);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(useActiveChatProfileStore.getState().profileId).toBe("old-profile");
  expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
    "/system/organization"
  );
  expect(list).not.toHaveBeenCalled();
  expect(
    queries.getQueryData<ProfileSummary[]>(queryKeys.profiles.all)
  ).toBeUndefined();
  await selectSharedAgent(container);
  expect(create).toHaveBeenCalledTimes(2);
  expect(useActiveChatProfileStore.getState().profileId).toBe("team-instance");
});

test.each([{ missing: false }, { missing: true }])(
  "failed or incomplete profile refresh blocks agent navigation %#",
  async ({ missing }) => {
    const { create, list } = observeAgentSelection();

    if (missing) {
      list.mockResolvedValueOnce({ profiles: [] });
    } else {
      list.mockRejectedValueOnce(new Error("Refresh failed"));
    }

    const { container, queries } = await mountResourceReader();
    const oldProfiles = [template("old-profile", "Old")];
    queries.setQueryData(queryKeys.profiles.all, oldProfiles);
    await selectSharedAgent(container);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(useActiveChatProfileStore.getState().profileId).toBe("old-profile");
    expect(
      queries.getQueryData<ProfileSummary[]>(queryKeys.profiles.all)
    ).toEqual(oldProfiles);
    expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
      "/system/organization"
    );
    await selectSharedAgent(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(useActiveChatProfileStore.getState().profileId).toBe(
      "team-instance"
    );
  }
);

test("pending profile refresh blocks repeated selection and early navigation", async () => {
  const { create, list } = observeAgentSelection();
  let resolve!: (response: { profiles: ProfileSummary[] }) => void;
  list.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { container } = await mountResourceReader();
  await selectSharedAgent(container);

  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Open shared agent"]'
  );

  expect(button?.disabled).toBe(true);
  await selectSharedAgent(container);
  expect(create).toHaveBeenCalledTimes(1);
  expect(useActiveChatProfileStore.getState().profileId).toBe("old-profile");
  expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
    "/system/organization"
  );
  await act(async () => {
    resolve({ profiles: [sharedAgentInstance().profile] });
    await settle();
  });
  expect(useActiveChatProfileStore.getState().profileId).toBe("team-instance");
});

test.each([{ phase: "create" }, { phase: "refresh" }])(
  "late agent selection cannot change a different team %#",
  async ({ phase }) => {
    const { create, list } = observeAgentSelection();
    let finish!: () => void;

    if (phase === "create") {
      create.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = () => resolve(sharedAgentInstance());
        })
      );
    } else {
      list.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = () => resolve({ profiles: [sharedAgentInstance().profile] });
        })
      );
    }

    const { container, queries, render } = await mountResourceReader();
    await selectSharedAgent(container);
    await render({ ...organization("team-b"), role: "member" });
    act(() => {
      useActiveChatProfileStore.setState({
        orgId: "team-b",
        profileId: "team-b-profile",
      });
    });
    const teamProfiles = [template("team-b-profile", "Team B")];
    queries.setQueryData(queryKeys.profiles.all, teamProfiles);
    await act(async () => {
      finish();
      await settle();
    });
    expect(useActiveChatProfileStore.getState().profileId).toBe(
      "team-b-profile"
    );
    expect(
      queries.getQueryData<ProfileSummary[]>(queryKeys.profiles.all)
    ).toEqual(teamProfiles);
    expect(
      queries.getQueryData<ProfileSummary[]>([
        ...queryKeys.profiles.all,
        "team-a",
      ])
    ).toBeUndefined();
    expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
      "/system/organization"
    );

    if (phase === "create") {
      expect(list).not.toHaveBeenCalled();
    }
  }
);

test.each([
  { parentOrgId: "parent", readiness: "unavailable", role: "member" },
  { parentOrgId: "parent", readiness: "requires_setup", role: "member" },
  { parentOrgId: null, readiness: "ready", role: "admin" },
  { parentOrgId: "parent", readiness: "ready", role: undefined },
] as const)(
  "non-selectable agent chips remain static %#",
  async ({ readiness, parentOrgId, role }) => {
    const { create, list } = observeAgentSelection();
    const { container, queries, render } = await mountResourceReader();
    const data = overview("team-a");
    data.sharedResources[2].readiness = readiness;
    await act(async () => {
      queries.setQueryData(
        queryKeys.organizationOverview("parent", "team-a"),
        data
      );

      if (!parentOrgId) {
        queries.setQueryData(
          queryKeys.organizationOverview("team-a", "team-a"),
          data
        );
      }

      await settle();
    });
    await render({ ...organization("team-a"), parentOrgId, role });
    expect(
      container.querySelector('button[aria-label^="Open shared agent"]')
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  }
);

function publishedTool(
  orgId = "team-a",
  description = "Shared description"
): ToolResponse {
  return {
    tool: {
      createdAt: "2026-10-12T00:00:00Z",
      description,
      handlerConfig: {
        privatePath: "/private/parent/tool.js",
        secret: "parent-key",
      },
      handlerType: "javascript",
      id: "tool",
      name: "Shared tool",
      publicationId: `${orgId}-tool`,
      scope: "parent",
      sourceOrganization: { id: "parent", name: "Parent" },
      updatedAt: "2026-10-12T00:00:00Z",
    },
  };
}

async function openSharedTool(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="View shared tool"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

test.each([
  { readiness: "ready", root: false },
  { readiness: "requires_setup", root: false },
  { readiness: "ready", root: true },
] as const)(
  "permitted tool details and setup keep active tenant scope %#",
  async ({ root, readiness }) => {
    const read = spyOn(client, "getTool").mockResolvedValue(
      publishedTool("team-a", '<script>alert("x")</script>')
    );

    const credentials = spyOn(client, "getToolCredentialStatus");
    const source = spyOn(client, "getToolSource");
    cleanups.push(() => {
      read.mockRestore();
      credentials.mockRestore();
      source.mockRestore();
    });
    const { container, queries, render } = await mountResourceReader("admin");
    const orgId = root ? "parent" : "team-a";
    const data = overview(orgId);
    data.sharedResources[3].readiness = readiness;
    await act(async () => {
      queries.setQueryData(
        queryKeys.organizationOverview("parent", orgId),
        data
      );
      await settle();
    });
    await render({
      ...organization(orgId),
      parentOrgId: root ? null : "parent",
      role: "admin",
    });
    expect(read).not.toHaveBeenCalled();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="View shared tool"]'
    );

    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await openSharedTool(container);
    expect(read.mock.calls).toEqual([["tool", orgId]]);
    expect(
      queries.getQueryData<ToolResponse>(
        queryKeys.tools.published(orgId, `${orgId}-tool`)
      )
    ).toEqual(publishedTool("team-a", '<script>alert("x")</script>'));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Parent");
    expect(dialog?.textContent).toContain('<script>alert("x")</script>');
    expect(dialog?.querySelector("script")).toBeNull();
    expect(dialog?.textContent).not.toContain("parent-key");
    expect(dialog?.textContent).not.toContain("/private/parent");
    expect(dialog?.querySelectorAll("input,textarea,select")).toHaveLength(0);
    expect(credentials).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-slot="dialog-footer"] button')
        ?.click();
      await settle();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
      "/system/playground/tool"
    );
    expect(read).toHaveBeenCalledTimes(1);
  }
);

test.each(["member"] as const)(
  "%s sees static tool chips without admin detail requests",
  async (role) => {
    const read = spyOn(client, "getTool");
    cleanups.push(() => read.mockRestore());
    const { container } = await mountResourceReader(role);
    expect(
      container.querySelector('button[aria-label^="View shared tool"]')
    ).toBeNull();
    expect(container.textContent).toContain("team-a tool");
    expect(read).not.toHaveBeenCalled();
  }
);

test("tool details retain loading and retry states and recheck on reopening", async () => {
  const pending = Promise.withResolvers<ToolResponse>();

  const read = spyOn(client, "getTool")
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(publishedTool())
    .mockRejectedValueOnce(new Error("Publication removed"));

  cleanups.push(() => read.mockRestore());
  const { container } = await mountResourceReader("admin");
  await openSharedTool(container);
  expect(
    document.querySelector('[role="dialog"] [role="status"]')
  ).not.toBeNull();
  expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
  await act(async () => {
    pending.reject(new Error("Read failed"));
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(document.querySelector('[role="dialog"] dl')).toBeNull();
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] [role="alert"] button')
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(document.querySelector('[role="dialog"] dl')).not.toBeNull();
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
      ?.click();
    await settle();
  });
  await openSharedTool(container);
  expect(read.mock.calls).toEqual(
    Array.from({ length: 3 }, () => ["tool", "team-a"])
  );
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(document.querySelector('[role="dialog"] dl')).toBeNull();
  expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
});

test("late tool details cannot enter another team's dialog", async () => {
  const pending = Promise.withResolvers<ToolResponse>();

  const read = spyOn(client, "getTool")
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(publishedTool("team-b", "Team B detail"));

  cleanups.push(() => read.mockRestore());
  const { container, render } = await mountResourceReader("admin");
  await openSharedTool(container);
  await render({ ...organization("team-b"), role: "admin" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openSharedTool(container);
  await act(async () => {
    pending.resolve(publishedTool("team-a", "Old team detail"));
    await settle();
  });
  expect(read.mock.calls).toEqual([
    ["tool", "team-a"],
    ["tool", "team-b"],
  ]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Team B detail"
  );
  expect(document.body.textContent).not.toContain("Old team detail");
});

test("unavailable tools remain static for an admin", async () => {
  const read = spyOn(client, "getTool");
  cleanups.push(() => read.mockRestore());
  const { container, queries } = await mountResourceReader("admin");
  const data = overview("team-a");
  data.sharedResources[3].readiness = "unavailable";
  await act(async () => {
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "team-a"),
      data
    );
    await settle();
  });
  expect(
    container.querySelector('button[aria-label^="View shared tool"]')
  ).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

function configuredSharedModels(): ModelsResponse {
  return {
    currentProviderId: "provider-a",
    displayName: null,
    models: ["provider-a", "provider-b"].map((providerId) => ({
      contextWindow: providerId === "provider-a" ? 1000 : 2000,
      id: "same-model",
      name: "Same model",
      provider: "openai" as const,
      providerId,
    })),
    provider: "openai",
    providers: ["provider-a", "provider-b"].map((id) => ({
      baseUrl: "https://private-provider.example.com",
      createdAt: "2026-10-12T00:00:00Z",
      hasApiKey: true,
      id,
      label: id === "provider-a" ? "First provider" : "Second provider",
      modelCount: 1,
      type: "openai" as const,
    })),
  };
}

function observeSharedModel() {
  const publications = spyOn(
    client,
    "listOrgSharedResources"
  ).mockImplementation(async (orgId) => ({
    resources: [
      {
        ...overview(orgId).sharedResources[4],
        resourceId: "provider-b::same-model",
        sourceOrganization: { id: "parent", name: "Current parent" },
      },
    ],
  }));

  const models = spyOn(client, "getModels").mockResolvedValue(
    configuredSharedModels()
  );

  cleanups.push(() => {
    publications.mockRestore();
    models.mockRestore();
  });

  return { models, publications };
}

async function openSharedModel(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="View shared model"]'
      )
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

test.each(["admin", "member"] as const)(
  "model details recheck publication and distinguish provider instances for %s",
  async (role) => {
    const { models, publications } = observeSharedModel();
    const { container } = await mountResourceReader(role);
    expect(models).not.toHaveBeenCalled();
    expect(publications).not.toHaveBeenCalled();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="View shared model"]'
    );

    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await openSharedModel(container);
    expect(publications.mock.calls).toEqual([["team-a"]]);
    expect(models).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Current parent");
    expect(
      [...dialog!.querySelectorAll("dd")].map((node) => node.textContent)
    ).toEqual([
      "Same model",
      "Second provider",
      "provider-b",
      "same-model",
      "2,000 tokens",
    ]);
    expect(dialog?.textContent).not.toContain("First provider");
    expect(dialog?.textContent).not.toContain("private-provider");
    expect(dialog?.querySelectorAll("input,textarea,select")).toHaveLength(0);

    const actions = document.querySelectorAll(
      '[data-slot="dialog-footer"] button'
    );

    expect(actions).toHaveLength(role === "admin" ? 1 : 0);

    if (role === "admin") {
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>(
            '[data-slot="dialog-footer"] button'
          )
          ?.click();
        await settle();
      });
      expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
        "/profiles"
      );
    }
  }
);

test("platform admins retain provider management", async () => {
  observeSharedModel();
  const { container } = await mountResourceReader("member", true);
  await openSharedModel(container);

  const actions = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-slot="dialog-footer"] button'
    ),
  ];

  expect(actions).toHaveLength(2);
  await act(async () => {
    actions[1]?.click();
    await settle();
  });
  expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
    "/settings/providers"
  );
});

test("root model details use root context without provider writes", async () => {
  const { models, publications } = observeSharedModel();
  const { container, queries, render } = await mountResourceReader("admin");
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    overview("parent")
  );
  await render({ ...organization("parent"), parentOrgId: null, role: "admin" });
  await openSharedModel(container);
  expect(publications.mock.calls).toEqual([["parent"]]);
  expect(models).toHaveBeenCalledTimes(1);
  expect(
    document.querySelectorAll('[data-slot="dialog-footer"] button')
  ).toHaveLength(1);
});

test.each([
  { failure: "removed" },
  { failure: "unavailable" },
  { failure: "wrong-kind" },
  { failure: "invalid-reference" },
  { failure: "missing-provider" },
  { failure: "wrong-instance" },
])(
  "invalid model publication or configuration hides details and actions %#",
  async ({ failure }) => {
    const { models, publications } = observeSharedModel();

    const publication = {
      ...overview("team-a").sharedResources[4],
      resourceId: "provider-b::same-model",
    };

    if (failure === "removed") {
      publications.mockResolvedValueOnce({ resources: [] });
    } else if (failure === "unavailable") {
      publications.mockResolvedValueOnce({
        resources: [{ ...publication, readiness: "unavailable" }],
      });
    } else if (failure === "wrong-kind") {
      publications.mockResolvedValueOnce({
        resources: [{ ...publication, resourceKind: "tool" }],
      });
    } else if (failure === "invalid-reference") {
      publications.mockResolvedValueOnce({
        resources: [{ ...publication, resourceId: "same-model" }],
      });
    } else if (failure === "missing-provider") {
      models.mockResolvedValueOnce({
        ...configuredSharedModels(),
        providers: configuredSharedModels().providers.slice(0, 1),
      });
    } else {
      models.mockResolvedValueOnce({
        ...configuredSharedModels(),
        models: configuredSharedModels().models.slice(0, 1),
      });
    }

    const { container } = await mountResourceReader("admin");
    await openSharedModel(container);
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')
    ).not.toBeNull();
    expect(document.querySelector('[role="dialog"] dl')).toBeNull();
    expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
    expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
      "/system/organization"
    );
    expect(models).toHaveBeenCalledTimes(
      ["missing-provider", "wrong-instance"].includes(failure) ? 1 : 0
    );
  }
);

test("model details retry and recheck access on reopening", async () => {
  const { publications } = observeSharedModel();

  const pending =
    Promise.withResolvers<
      Awaited<ReturnType<typeof client.listOrgSharedResources>>
    >();

  publications.mockImplementationOnce(() => pending.promise);
  const { container } = await mountResourceReader("admin");
  await openSharedModel(container);
  expect(
    document.querySelector('[role="dialog"] [role="status"]')
  ).not.toBeNull();
  expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
  await act(async () => {
    pending.reject(new Error("Read failed"));
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] [role="alert"] button')
      ?.click();
    await settle();
  });
  await act(async () => {
    await settle();
  });
  expect(document.querySelector('[role="dialog"] dl')).not.toBeNull();
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
      ?.click();
    await settle();
  });
  publications.mockResolvedValueOnce({ resources: [] });
  await openSharedModel(container);
  expect(publications).toHaveBeenCalledTimes(3);
  expect(document.querySelector('[role="dialog"] dl')).toBeNull();
  expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
});

test("late model configuration cannot enter another team's dialog", async () => {
  const { models, publications } = observeSharedModel();
  const pending = Promise.withResolvers<ModelsResponse>();
  models.mockImplementationOnce(() => pending.promise);
  const { container, render } = await mountResourceReader("admin");
  await openSharedModel(container);
  await render({ ...organization("team-b"), role: "admin" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openSharedModel(container);
  const oldModels = configuredSharedModels();
  oldModels.models[1].name = "Old team model";
  await act(async () => {
    pending.resolve(oldModels);
    await settle();
  });
  expect(publications.mock.calls).toEqual([["team-a"], ["team-b"]]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Same model"
  );
  expect(document.body.textContent).not.toContain("Old team model");
});

test("unavailable model chips remain static", async () => {
  const { models, publications } = observeSharedModel();
  const { container, queries } = await mountResourceReader("admin");
  const data = overview("team-a");
  data.sharedResources[4].readiness = "unavailable";
  await act(async () => {
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "team-a"),
      data
    );
    await settle();
  });
  expect(
    container.querySelector('button[aria-label^="View shared model"]')
  ).toBeNull();
  expect(publications).not.toHaveBeenCalled();
  expect(models).not.toHaveBeenCalled();
});

test.each([
  { agents: 1, platform: false, role: "admin", skills: 0 },
  { agents: 0, platform: false, role: "member", skills: 0 },
  { agents: 1, platform: true, role: "member", skills: 1 },
] as const)(
  "root source links use existing permissions and stable IDs %#",
  async ({ role, platform, agents, skills }) => {
    const create = spyOn(client, "createSharedAgentInstance");
    cleanups.push(() => create.mockRestore());

    const { container, queries, render } = await mountResourceReader(
      role,
      platform
    );

    const data = overview("parent");
    data.sharedResources[1].label = "Same name";
    data.sharedResources[1].resourceId = "source/skill?";
    data.sharedResources[2].label = "Same name";
    data.sharedResources[2].resourceId = "source/agent?";
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );
    await render({ ...organization("parent"), parentOrgId: null, role });

    const agent = container.querySelector<HTMLAnchorElement>(
      'a[aria-label^="View published agent"]'
    );

    const skill = container.querySelector<HTMLAnchorElement>(
      'a[aria-label^="View published skill"]'
    );

    expect(
      container.querySelectorAll('a[aria-label^="View published agent"]')
    ).toHaveLength(agents);
    expect(
      container.querySelectorAll('a[aria-label^="View published skill"]')
    ).toHaveLength(skills);
    expect(create).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[aria-label^="Open shared agent"]')
    ).toBeNull();

    if (agents) {
      expect(agent?.getAttribute("href")).toBe(
        "/profiles?profile=source%2Fagent%3F"
      );
      agent?.focus();
      expect(document.activeElement).toBe(agent);
      await act(async () => {
        agent?.click();
        await settle();
      });
      expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
        "/profiles?profile=source%2Fagent%3F"
      );
      expect(create).not.toHaveBeenCalled();
    }

    if (skills) {
      expect(skill?.getAttribute("href")).toBe(
        "/profiles/skills/source%2Fskill%3F"
      );
      skill?.focus();
      expect(document.activeElement).toBe(skill);
      await act(async () => {
        skill?.click();
        await settle();
      });
      expect(container.querySelector("[data-chat-location]")?.textContent).toBe(
        "/profiles/skills/source%2Fskill%3F"
      );
    }
  }
);

test.each([
  { readiness: "unavailable" },
  { readiness: "requires_setup" },
] as const)(
  "unavailable root sources have no detail link %#",
  async ({ readiness }) => {
    const { container, queries, render } = await mountResourceReader(
      "admin",
      true
    );

    const data = overview("parent");
    data.sharedResources[1].readiness = readiness;
    data.sharedResources[2].readiness = readiness;
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "parent"),
      data
    );
    await render({
      ...organization("parent"),
      parentOrgId: null,
      role: "admin",
    });
    expect(
      container.querySelectorAll('a[aria-label^="View published"]')
    ).toHaveLength(0);
    expect(container.textContent).toContain(data.sharedResources[1].label);
    expect(container.textContent).toContain(data.sharedResources[2].label);
  }
);

test("root source links cannot use foreign publication owners", async () => {
  const { container, queries, render } = await mountResourceReader(
    "admin",
    true
  );

  const data = overview("parent");
  data.sharedResources[1].orgId = "foreign";
  data.sharedResources[2].orgId = "foreign";
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "parent"),
    data
  );
  await render({ ...organization("parent"), parentOrgId: null, role: "admin" });
  expect(
    container.querySelectorAll('a[aria-label^="View published"]')
  ).toHaveLength(0);
});

test("team users never receive direct links to parent sources", async () => {
  const { container } = await mountResourceReader("admin", true);
  expect(
    container.querySelectorAll('a[aria-label^="View published"]')
  ).toHaveLength(0);
  expect(
    container.querySelector('button[aria-label^="Open shared agent"]')
  ).not.toBeNull();
  expect(
    container.querySelector('button[aria-label^="View shared skill"]')
  ).not.toBeNull();
});
