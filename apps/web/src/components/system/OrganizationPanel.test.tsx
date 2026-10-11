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
  switchOrg: AuthContextValue["switchOrg"] = async () => undefined
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
    async render(org: OrganizationSummary) {
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
        refreshSession: async () => undefined,
        setup: async () => undefined,
        switchOrg,
        updateOrg: async () => undefined,
        user: null,
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
