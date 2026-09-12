import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type {
  OrgPluginDetail,
  ProfileDetail,
  SkillSummary,
  ToolDetail,
  ToolSummary,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import {
  formatPluginTrustLines,
  groupPluginTools,
  isPluginOwned,
  nextPluginVersions,
  orgPluginQueryOptions,
  orgPluginsQueryOptions,
  pluginAgentAccessState,
  pluginRowActions,
  pluginUiModuleUrl,
  resolvePluginPageView,
  savePluginAgentAccess,
  useEnableOrgPlugin,
  useInstallPluginPackage,
  usePluginAgentAccess,
  useReinstallOfficialPlugin,
  useSavePluginAgentAccess,
} from "@/hooks/use-plugins";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { PluginPageState } from "@/pages/PluginPage";
import { PluginsPage } from "@/pages/PluginsPage";

const enable = spyOn(client, "enableOrgPlugin");
const installPackage = spyOn(client, "installPluginPackage");
const reinstallOfficial = spyOn(client, "reinstallOfficialPlugin");
const accessApi = {
  assignSkill: spyOn(client, "assignSkill"),
  assignTool: spyOn(client, "assignTool"),
  plugin: spyOn(client, "getOrgPlugin"),
  profile: spyOn(client, "getProfile"),
  profiles: spyOn(client, "listProfiles"),
  skills: spyOn(client, "listSkills"),
  tools: spyOn(client, "listTools"),
  unassignSkill: spyOn(client, "unassignSkill"),
  unassignTool: spyOn(client, "unassignTool"),
};
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
});

afterEach(() => {
  for (const method of Object.values(accessApi)) {
    method.mockReset();
  }
  enable.mockReset();
  installPackage.mockReset();
  reinstallOfficial.mockReset();
  queryClient.clear();
});

afterAll(() => {
  for (const method of Object.values(accessApi)) {
    method.mockRestore();
  }
  enable.mockRestore();
  installPackage.mockRestore();
  reinstallOfficial.mockRestore();
});

function plugin(overrides: Partial<OrgPluginDetail> = {}): OrgPluginDetail {
  return {
    actions: [],
    availableVersions: ["1.0.0"],
    databaseGeneration: null,
    description: "",
    installed: true,
    lastLifecycleError: null,
    lifecycleState: "disabled",
    name: "Notes",
    pendingOperation: null,
    pluginId: "notes",
    revision: 3,
    selectedVersion: "1.0.0",
    ui: {
      assetsDir: "ui",
      entryModule: "index.js",
      pageLabel: "Notes",
    },
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

const authValue = {
  activeOrg: { id: "org-a", name: "A", role: "admin", slug: "a" },
  archiveOrg: async () => undefined,
  createOrg: async () => undefined,
  isAuthenticated: true,
  isLoading: false,
  login: async () => undefined,
  logout: async () => undefined,
  orgs: [],
  refreshSession: async () => undefined,
  setup: async () => undefined,
  switchOrg: async () => undefined,
  updateOrg: async () => undefined,
  user: { email: "a@b.c", id: "u1", isPlatformAdmin: true, name: "A" },
} as unknown as AuthContextValue;

function renderEnable() {
  let mutation: ReturnType<typeof useEnableOrgPlugin>;
  function Probe() {
    mutation = useEnableOrgPlugin();
    return null;
  }
  renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        AuthContext.Provider,
        { value: authValue },
        createElement(Probe)
      )
    )
  );
  return () => mutation.mutateAsync({ expectedRevision: 3, pluginId: "notes" });
}

describe("plugin management authority and mutations", () => {
  test.each(["/system", "/system/plugins/notes", "/system/plugins/missing"])(
    "plugin details are addressable separately from the grid: %s",
    (path) => {
      queryClient.setQueryData(queryKeys.plugins.all("org-a"), {
        plugins: [
          plugin({ description: "Saved notes for your agents" }),
          plugin({ name: "Other plugin", pluginId: "other" }),
        ],
      });
      queryClient.setQueryData(["official-plugins"], { plugins: [] });
      queryClient.setQueryData(queryKeys.plugins.releases, { releases: [] });
      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={authValue}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route element={<PluginsPage />} path="/system" />
                <Route
                  element={<PluginsPage />}
                  path="/system/plugins/:pluginId"
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      expect(html).not.toContain("<details");
      if (path === "/system") {
        expect(html).toContain('href="/system/plugins/notes"');
        expect(html).toContain("Other plugin");
        expect(html).toContain("Saved notes for your agents");
        expect(html).not.toContain("1.0.0");
      } else {
        expect(html).toContain('href="/system?tab=plugins"');
        expect(html).not.toContain("Other plugin");
        expect(html).toContain(
          path.endsWith("notes")
            ? "Saved notes for your agents"
            : "Plugin not found."
        );
      }
    }
  );
  test.each([false, true])(
    "external install entry is platform-admin-only: %s",
    (isPlatformAdmin) => {
      queryClient.setQueryData(queryKeys.plugins.all("org-a"), {
        plugins: [plugin({ icon: "https://example.com/notes.svg" })],
      });
      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{
              ...authValue,
              user: { ...authValue.user!, isPlatformAdmin },
            }}
          >
            <MemoryRouter>
              <PluginsPage />
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      expect(html.includes(">Install external plugin</button>")).toBe(
        isPlatformAdmin
      );
      expect(html).not.toContain('aria-label="npm package name"');
      expect(html).not.toContain('aria-label="Exact package version"');
      expect(html).toContain('src="https://example.com/notes.svg"');
    }
  );
  test.each(["admin", "member"] as const)(
    "official plugins render once with admin-only management: %s",
    (role) => {
      queryClient.setQueryData(["official-plugins"], {
        plugins: [
          {
            description: "",
            id: "workflows",
            name: "Workflows",
            version: "1.0.1",
          },
          {
            description: "",
            id: "supermemory",
            name: "Supermemory",
            version: "1.0.0",
          },
        ],
      });
      queryClient.setQueryData(queryKeys.plugins.all("org-a"), {
        plugins: [
          plugin({
            lifecycleState: "enabled",
            name: "Workflows",
            pluginId: "workflows",
          }),
        ],
      });
      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{
              ...authValue,
              activeOrg: { ...authValue.activeOrg!, role },
              user: { ...authValue.user!, isPlatformAdmin: false },
            }}
          >
            <MemoryRouter>
              <PluginsPage />
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      expect(html.match(/href="\/plugins\/workflows"/g)).toHaveLength(1);
      expect(html.match(/>Supermemory</g)).toHaveLength(1);
      expect(html.includes('href="/plugins/supermemory"')).toBe(false);
      expect(html).not.toContain("No plugins installed.");
      expect(html).toContain('aria-label="Open Workflows"');
      expect(html).not.toContain(">Open</a>");
      expect(html.includes('aria-label="Install Supermemory"')).toBe(
        role === "admin"
      );
      expect(html).not.toMatch(/<details[^>]*\bopen/);
      expect(html).toContain('aria-label="Actions for Workflows"');
    }
  );
  test.each([false, true])(
    "official reinstall refreshes state even when failure=%s",
    async (fails) => {
      if (fails) {
        reinstallOfficial.mockRejectedValue(new Error("Migration failed"));
      } else {
        reinstallOfficial.mockResolvedValue({ install: {} });
      }
      queryClient.setQueryData(queryKeys.plugins.all("org-a"), { plugins: [] });
      queryClient.setQueryData(
        queryKeys.plugins.detail("org-a", "workflows"),
        plugin()
      );
      queryClient.setQueryData(queryKeys.plugins.releases, { releases: [] });
      let mutate!: ReturnType<typeof useReinstallOfficialPlugin>["mutateAsync"];
      function Probe() {
        mutate = useReinstallOfficialPlugin().mutateAsync;
        return null;
      }
      renderToString(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={authValue}>
            <Probe />
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      const result = mutate({ expectedRevision: 7, pluginId: "workflows" });
      if (fails) {
        await expect(result).rejects.toThrow();
      } else {
        await result;
      }
      expect(reinstallOfficial).toHaveBeenCalledWith("workflows", 7, "org-a");
      expect(
        queryClient.getQueryState(queryKeys.plugins.all("org-a"))?.isInvalidated
      ).toBe(true);
      expect(
        queryClient.getQueryState(
          queryKeys.plugins.detail("org-a", "workflows")
        )?.isInvalidated
      ).toBe(true);
      expect(
        queryClient.getQueryState(queryKeys.plugins.releases)?.isInvalidated
      ).toBe(true);
    }
  );
  test.each([
    {
      actions: ["Enable", "Update", "Uninstall"],
      role: "admin" as const,
      state: "disabled" as const,
    },
    { actions: ["Disable"], role: "admin" as const, state: "enabled" as const },
    {
      actions: ["Delete data"],
      role: "admin" as const,
      state: "retained" as const,
    },
    { actions: [], role: "member" as const, state: "disabled" as const },
    { actions: [], role: "member" as const, state: "enabled" as const },
  ])(
    "renders $role actions for a $state plugin",
    ({ role, state, actions }) => {
      queryClient.setQueryData(queryKeys.plugins.all("org-a"), {
        plugins: [
          plugin({
            availableVersions: ["1.0.0", "1.1.0"],
            lifecycleState: state,
          }),
        ],
      });
      const html = renderToString(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{
              ...authValue,
              activeOrg: { ...authValue.activeOrg!, role },
              user: { ...authValue.user!, isPlatformAdmin: false },
            }}
          >
            <MemoryRouter>
              <PluginsPage />
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      const buttons = [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(
        (match) => match[1].replace(/<[^>]*>/g, "")
      );
      expect(buttons.filter(Boolean)).toEqual(
        actions.some((action) => action === "Enable") ? ["Enable"] : []
      );
      expect(html).toContain('aria-label="Actions for Notes"');
      expect(html.includes('href="/plugins/notes"')).toBe(state === "enabled");
    }
  );

  test("enable sends expectedRevision and invalidates org-scoped keys", async () => {
    const enabled = plugin({ lifecycleState: "enabled", revision: 4 });
    enable.mockResolvedValue(enabled);
    queryClient.setQueryData(queryKeys.plugins.all("org-a"), {
      plugins: [plugin()],
    });
    queryClient.setQueryData(
      queryKeys.plugins.detail("org-a", "notes"),
      plugin()
    );

    await renderEnable()();

    expect(enable).toHaveBeenCalledWith("notes", 3, "org-a");
    expect(
      queryClient.getQueryState(queryKeys.plugins.all("org-a"))?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState(queryKeys.plugins.detail("org-a", "notes"))
        ?.isInvalidated
    ).toBe(true);
  });

  test("npm install is a platform package call", async () => {
    installPackage.mockResolvedValue({
      createdAt: "2026-09-07T00:00:00.000Z",
      digest: "abc",
      manifest: {
        actions: [],
        apiVersion: 1,
        author: "Ada",
        description: "",
        id: "notes",
        license: "MIT",
        minNakamaVersion: "0.1.0",
        name: "Notes",
        skills: [],
        version: "1.0.0",
      },
      pluginId: "notes",
      reused: false,
      version: "1.0.0",
    });

    let mutate: ReturnType<typeof useInstallPluginPackage>["mutateAsync"];
    function Probe() {
      mutate = useInstallPluginPackage().mutateAsync;
      return null;
    }
    renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          AuthContext.Provider,
          { value: authValue },
          createElement(Probe)
        )
      )
    );

    await mutate!({
      expectedDigest: "abc",
      expectedIntegrity: "sha512-abc",
      packageName: "@team/notes",
      version: "1.0.0",
    });
    expect(installPackage).toHaveBeenCalled();
  });

  test("uninstall is available while enabled; update requires disabled and purge requires retained", () => {
    const enabled = plugin({
      availableVersions: ["1.0.0", "1.1.0"],
      lifecycleState: "enabled",
      selectedVersion: "1.0.0",
    });
    expect(pluginRowActions(enabled)).toEqual({
      disable: true,
      enable: false,
      purge: false,
      uninstall: true,
      update: false,
    });

    const disabled = plugin({
      availableVersions: ["1.0.0", "1.1.0"],
      lifecycleState: "disabled",
      selectedVersion: "1.0.0",
    });
    expect(pluginRowActions(disabled)).toEqual({
      disable: false,
      enable: true,
      purge: false,
      uninstall: true,
      update: true,
    });

    const retained = plugin({
      databaseGeneration: "gen-1",
      lifecycleState: "retained",
    });
    expect(pluginRowActions(retained)).toEqual({
      disable: false,
      enable: false,
      purge: true,
      uninstall: false,
      update: false,
    });
  });
});

describe("plugin agent access", () => {
  const tool = { id: "notes-tool", pluginId: "notes" } as ToolDetail;
  const otherTool = { id: "other-tool", pluginId: "other" } as ToolDetail;
  const skill = { id: "notes-skill", pluginId: "notes" } as SkillSummary;
  const otherSkill = { id: "other-skill", pluginId: "other" } as SkillSummary;
  const resources = { skills: [skill, otherSkill], tools: [tool, otherTool] };
  function agent(tools: ToolSummary[] = [], skills: SkillSummary[] = []) {
    return { id: "agent-a", name: "Agent A", skills, tools } as ProfileDetail;
  }
  function setup(profile: ProfileDetail) {
    accessApi.plugin.mockResolvedValue(plugin({ lifecycleState: "enabled" }));
    accessApi.profile.mockResolvedValue({ profile });
    accessApi.tools.mockResolvedValue({ tools: resources.tools });
    accessApi.skills.mockResolvedValue({ skills: resources.skills });
    accessApi.assignTool.mockResolvedValue({ profile });
    accessApi.unassignTool.mockResolvedValue({ profile });
    accessApi.assignSkill.mockResolvedValue({ profile });
    accessApi.unassignSkill.mockResolvedValue({ profile });
  }

  test("distinguishes full, partial, and no access", () => {
    expect(
      pluginAgentAccessState(agent([tool], [skill]), "notes", resources)
    ).toEqual({ assigned: 2, full: true, total: 2 });
    expect(pluginAgentAccessState(agent([tool]), "notes", resources)).toEqual({
      assigned: 1,
      full: false,
      total: 2,
    });
    expect(
      pluginAgentAccessState(
        agent([otherTool], [otherSkill]),
        "notes",
        resources
      )
    ).toEqual({ assigned: 0, full: false, total: 2 });
    expect(pluginAgentAccessState(agent(), "ui-only", resources)).toEqual({
      assigned: 0,
      full: false,
      total: 0,
    });
  });

  test("grants missing capabilities without changing unrelated assignments", async () => {
    setup(agent([tool, otherTool], [otherSkill]));
    await savePluginAgentAccess("org-a", "notes", { "agent-a": true });
    expect(accessApi.assignTool).not.toHaveBeenCalled();
    expect(accessApi.assignSkill).toHaveBeenCalledTimes(1);
    expect(accessApi.assignSkill).toHaveBeenCalledWith(
      "agent-a",
      { skillId: "notes-skill" },
      "org-a"
    );
    expect(accessApi.unassignTool).not.toHaveBeenCalled();
    expect(accessApi.unassignSkill).not.toHaveBeenCalled();
    expect(accessApi.profile).toHaveBeenCalledWith("agent-a", "org-a");
    expect(accessApi.tools).toHaveBeenCalledWith("org-a");
    expect(accessApi.skills).toHaveBeenCalledWith("org-a");
  });

  test("revokes only this plugin's tools and skills", async () => {
    setup(agent([tool, otherTool], [skill, otherSkill]));
    await savePluginAgentAccess("org-a", "notes", { "agent-a": false });
    expect(accessApi.unassignTool).toHaveBeenCalledTimes(1);
    expect(accessApi.unassignTool).toHaveBeenCalledWith(
      "agent-a",
      "notes-tool",
      "org-a"
    );
    expect(accessApi.unassignSkill).toHaveBeenCalledTimes(1);
    expect(accessApi.unassignSkill).toHaveBeenCalledWith(
      "agent-a",
      "notes-skill",
      "org-a"
    );
    expect(accessApi.assignTool).not.toHaveBeenCalled();
    expect(accessApi.assignSkill).not.toHaveBeenCalled();
  });

  test("retry after partial failure skips assignments already saved", async () => {
    setup(agent());
    accessApi.assignSkill.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(
      savePluginAgentAccess("org-a", "notes", { "agent-a": true })
    ).rejects.toThrow();
    accessApi.profile.mockResolvedValue({ profile: agent([tool]) });
    await savePluginAgentAccess("org-a", "notes", { "agent-a": true });
    expect(accessApi.assignTool).toHaveBeenCalledTimes(1);
    expect(accessApi.assignSkill).toHaveBeenCalledTimes(2);
  });

  test("refuses assignments when the plugin was disabled", async () => {
    setup(agent());
    accessApi.plugin.mockResolvedValue(plugin());
    await expect(
      savePluginAgentAccess("org-a", "notes", { "agent-a": true })
    ).rejects.toThrow();
    expect(accessApi.profile).not.toHaveBeenCalled();
    expect(accessApi.assignTool).not.toHaveBeenCalled();
    expect(accessApi.assignSkill).not.toHaveBeenCalled();
  });

  test("loads org-scoped access counts and refreshes them after saving", async () => {
    const profile = agent([tool]);
    setup(profile);
    accessApi.profiles.mockResolvedValue({ profiles: [profile] });
    let access!: ReturnType<typeof usePluginAgentAccess>;
    let save!: ReturnType<typeof useSavePluginAgentAccess>;
    function Probe() {
      access = usePluginAgentAccess();
      save = useSavePluginAgentAccess();
      return null;
    }
    renderToString(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue}>
          <Probe />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
    const result = await access.refetch();
    expect(result.data?.counts).toEqual({ notes: 1, other: 0 });
    expect(accessApi.profiles).toHaveBeenCalledWith("org-a");
    await save.mutateAsync({ changes: { "agent-a": true }, pluginId: "notes" });
    expect(
      queryClient.getQueryState([
        ...queryKeys.profiles.all,
        "plugin-access",
        "org-a",
      ])?.isInvalidated
    ).toBe(true);
  });
});

describe("plugin page states and module contract", () => {
  test("query keys include orgId so org switches drop stale work", () => {
    expect(queryKeys.plugins.all("org-a")).toEqual(["plugins", "org-a"]);
    expect(queryKeys.plugins.detail("org-b", "notes")).toEqual([
      "plugins",
      "org-b",
      "notes",
    ]);
    expect([...orgPluginsQueryOptions("org-a").queryKey]).toEqual([
      "plugins",
      "org-a",
    ]);
    expect(orgPluginQueryOptions("org-a", "notes").queryKey).not.toEqual(
      orgPluginQueryOptions("org-b", "notes").queryKey
    );
  });

  test("module URL separates orgs, revisions, and reinstalled versions", () => {
    expect(pluginUiModuleUrl("org-a", "notes", 3, "1.0.0")).toBe(
      "/v1/plugins/ui/org-a/notes/?revision=3&version=1.0.0"
    );
    expect(pluginUiModuleUrl("org-a", "notes", 4, "1.0.0")).not.toBe(
      pluginUiModuleUrl("org-b", "notes", 4, "1.0.0")
    );
    expect(pluginUiModuleUrl("org-a", "notes", 3, "1.0.0")).not.toBe(
      pluginUiModuleUrl("org-a", "notes", 3, "2.0.0")
    );
  });

  test("disabled, unavailable, failed, and unauthorized are named states", () => {
    expect(
      resolvePluginPageView({
        orgRole: "viewer",
        queryStatus: "pending",
      })
    ).toBe("unauthorized");
    expect(
      resolvePluginPageView({
        errorStatus: 403,
        orgRole: "member",
        queryStatus: "error",
      })
    ).toBe("unauthorized");
    expect(
      resolvePluginPageView({
        orgRole: "member",
        plugin: plugin({ lifecycleState: "disabled" }),
        queryStatus: "success",
      })
    ).toBe("disabled");
    expect(
      resolvePluginPageView({
        orgRole: "member",
        plugin: plugin({
          lastLifecycleError: "package_unavailable",
          lifecycleState: "enabled",
        }),
        queryStatus: "success",
      })
    ).toBe("unavailable");
    expect(
      resolvePluginPageView({
        orgRole: "member",
        plugin: plugin({ lifecycleState: "enabled", ui: null }),
        queryStatus: "success",
      })
    ).toBe("unavailable");
    expect(
      resolvePluginPageView({
        orgRole: "member",
        plugin: plugin({ lifecycleState: "enabled" }),
        queryStatus: "success",
      })
    ).toBe("page");
  });

  test("state view is a heading plus a route, not an empty frame", () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        null,
        createElement(PluginPageState, {
          canManage: true,
          kind: "failed",
        })
      )
    );
    expect(html).toContain("/system?tab=plugins");
    expect(html).not.toContain("<iframe");
    expect(html.match(/<h1\b/g)).toBeNull();
  });

  test("viewer deep link points to chat, not management", () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        null,
        createElement(PluginPageState, {
          canManage: false,
          kind: "unauthorized",
        })
      )
    );
    expect(html).toContain("/chat");
    expect(html).not.toContain("/system?tab=plugins");
    expect(html).not.toContain("<iframe");
  });
});

describe("plugin ownership and update helpers", () => {
  test("owned tools and skills are marked by pluginId", () => {
    expect(isPluginOwned({ pluginId: "notes" })).toBe(true);
    expect(isPluginOwned({ pluginId: null })).toBe(false);
  });

  test("update versions exclude the selected version", () => {
    expect(
      nextPluginVersions(
        plugin({
          availableVersions: ["1.0.0", "1.1.0"],
          selectedVersion: "1.0.0",
        })
      )
    ).toEqual(["1.1.0"]);
  });

  test("install trust lines include identity and digest", () => {
    const lines = formatPluginTrustLines({
      contributions: {
        actionKeys: ["list"],
        hasDatabase: true,
        hasUi: true,
        skillKeys: [],
      },
      digest: "deadbeef",
      integrity: "sha512-abc",
      manifest: {
        actions: [],
        apiVersion: 1,
        author: "Ada",
        description: "",
        id: "notes",
        license: "MIT",
        minNakamaVersion: "0.1.0",
        name: "Notes",
        skills: [],
        version: "1.0.0",
      },
    });
    expect(lines.join(" ")).toContain("Ada");
    expect(lines.join(" ")).toContain("deadbeef");
    expect(lines.join(" ")).toContain("notes");
  });
});

test("plugin assignment groups keep every action ID and separate ordinary tools", () => {
  const tools = [
    { id: "read", name: "read_file" },
    { id: "create", name: "plugin_workflows__create", pluginId: "workflows" },
    { id: "notes", name: "plugin_notes__list", pluginId: "notes" },
    { id: "run", name: "plugin_workflows__run", pluginId: "workflows" },
  ] as ToolSummary[];
  expect(
    groupPluginTools(tools).map((group) => group.tools.map((tool) => tool.id))
  ).toEqual([["read"], ["create", "run"], ["notes"]]);
  expect(tools).toHaveLength(4);
});
