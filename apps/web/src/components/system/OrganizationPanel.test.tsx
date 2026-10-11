import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  OrganizationOverviewResponse,
  OrganizationSummary,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
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

function mount(
  queryClient: QueryClient,
  switchOrg: AuthContextValue["switchOrg"] = async () => undefined,
  refreshSession: AuthContextValue["refreshSession"] = async () => undefined
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
    async render(org: NonNullable<AuthContextValue["activeOrg"]>) {
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
        orgs: [],
        platformOrgs: [],
        platformOrgsError: false,
        refreshPlatformOrgs: async () => undefined,
        refreshSession,
        setup: async () => undefined,
        switchOrg,
        updateOrg: async () => undefined,
        user: { email: "creator@example.com", id: "creator" },
      };

      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <AuthContext.Provider value={auth}>
              <OrganizationOverview />
            </AuthContext.Provider>
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
  expect(container.querySelector("li p")?.textContent).toContain("14");
  expect(
    [...container.querySelectorAll("li dd")].map((node) => node.textContent)
  ).toEqual(["3", "5", "4", "2"]);
  expect(container.querySelectorAll("dd button")).toHaveLength(0);
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

test("team details open without switching and permitted switching waits for success", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("team-a");
  data.teams[0].id = "team-b";
  data.teams[0].slug = "sales";
  data.teams[0].name = "Sales";
  data.teams[0].isCurrent = false;
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    data
  );
  const pending = Promise.withResolvers<void>();
  const switchOrg = mock((_id: string) => pending.promise);
  const { container, render } = mount(queries, switchOrg);
  await render(organization("team-a"));
  const trigger = container.querySelector("button");
  trigger?.focus();
  expect(document.activeElement).toBe(trigger);
  await act(async () => {
    trigger?.click();
    await settle();
  });
  expect(switchOrg).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("team-b");
  expect(dialog?.textContent).toContain("sales");
  expect(
    [...dialog!.querySelectorAll("dd")].map((node) => node.textContent)
  ).toEqual(["team-b", "sales", "14", "3", "5", "4", "2"]);
  const submit = dialog?.querySelector("button");
  await act(async () => {
    submit?.click();
    submit?.click();
    await settle();
  });
  expect(switchOrg.mock.calls).toEqual([["team-b"]]);
  expect(submit?.disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    pending.resolve();
    await settle();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test.each([true, false])(
  "team details prevent switching when permitted is %s",
  async (canSwitch) => {
    const queries = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });

    const data = overview("team-a");
    data.teams[0].canSwitch = canSwitch;
    data.teams[0].id = canSwitch ? "team-a" : "team-b";
    data.teams[0].isCurrent = !canSwitch;
    queries.setQueryData(
      queryKeys.organizationOverview("parent", "team-a"),
      data
    );
    const switchOrg = mock(async () => undefined);
    const { container, render } = mount(queries, switchOrg);
    await render(organization("team-a"));
    await act(async () => {
      container.querySelector("button")?.click();
      await settle();
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll("button")).toHaveLength(1);
    expect(switchOrg).not.toHaveBeenCalled();
  }
);

test("failed switching retains team details and permits retry", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  const data = overview("team-a");
  data.teams[0].id = "team-b";
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    data
  );

  const switchOrg = mock(
    async (_id: string) => undefined
  ).mockRejectedValueOnce(new Error("Switch failed"));

  const { container, render } = mount(queries, switchOrg);
  await render(organization("team-a"));
  await act(async () => {
    container.querySelector("button")?.click();
    await settle();
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] button')
      ?.click();
    await settle();
  });
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')
  ).not.toBeNull();
  expect(container.querySelector("h2")?.textContent).toBe(
    data.organization.name
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] button')
      ?.click();
    await settle();
  });
  expect(switchOrg.mock.calls).toEqual([["team-b"], ["team-b"]]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("team changes discard open details from the previous organization", async () => {
  const queries = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-a"),
    overview("team-a")
  );
  queries.setQueryData(
    queryKeys.organizationOverview("parent", "team-b"),
    overview("team-b")
  );
  const { container, render } = mount(queries);
  await render(organization("team-a"));
  await act(async () => {
    container.querySelector("button")?.click();
    await settle();
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await render(organization("team-b"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("Team team-a");
});

async function fillTeamForm(adminUserId = "creator") {
  await act(async () => {
    for (const [field, value] of [
      ["name", "Support"],
      ["slug", "support"],
      ["admin", adminUserId],
    ]) {
      const input = document.querySelector<HTMLInputElement>(
        `input[id$="-${field}"]`
      );

      expect(input).not.toBeNull();
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value"
      )?.set?.call(input, value);
      input?.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
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
      container.querySelector("button")?.click();
      await settle();
    });
    expect(
      document.querySelector<HTMLInputElement>('input[id$="-admin"]')?.value
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
    expect(container.querySelector("h2")?.textContent).toBe(
      data.organization.name
    );
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
    container.querySelector("button")?.click();
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
    container.querySelector("button")?.click();
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
    container.querySelector("button")?.click();
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
    container.querySelector("button")?.click();
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
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
    "View Team team-a"
  );
});
