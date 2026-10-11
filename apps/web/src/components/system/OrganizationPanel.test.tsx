import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  OrganizationOverviewResponse,
  OrganizationSummary,
  ProfileResponse,
  ProfileSummary,
  SkillSummary,
  ToolResponse,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";
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
            <MemoryRouter initialEntries={["/system/organization"]}>
              <AuthContext.Provider value={auth}>
                <OrganizationOverview />
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
  expect(container.querySelectorAll("dd button")).toHaveLength(2);
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
  const trigger = container.querySelector<HTMLButtonElement>("li button");
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
      container.querySelector<HTMLButtonElement>("li button")?.click();
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
    container.querySelector<HTMLButtonElement>("li button")?.click();
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
    container.querySelector<HTMLButtonElement>("li button")?.click();
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
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add team"]')
        ?.click();
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
      .querySelector<HTMLButtonElement>("li button")
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
  queries.setQueryData(toolKey, publishedTool());

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
        { ...template("super", "Super Bot"), isSuper: true },
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
  role: "admin" | "member" | "viewer" = "member"
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

  const result = mount(queries);
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

test.each(["admin", "member", "viewer"] as const)(
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

test.each(["admin", "member", "viewer"] as const)(
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

test("viewers cannot select shared agents", async () => {
  const { create, list } = observeAgentSelection();
  const { container } = await mountResourceReader("viewer");
  expect(
    container.querySelector('button[aria-label^="Open shared agent"]')
  ).toBeNull();
  expect(create).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});

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

test.each(["member", "viewer"] as const)(
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
