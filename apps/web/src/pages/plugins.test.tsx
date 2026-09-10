import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { OrgPluginDetail, ToolSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
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
  pluginRowActions,
  pluginUiModuleUrl,
  resolvePluginPageView,
  useEnableOrgPlugin,
  useInstallPluginPackage,
  useReinstallOfficialPlugin,
} from "@/hooks/use-plugins";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { PluginPageState } from "@/pages/PluginPage";
import { PluginsPage } from "@/pages/PluginsPage";

const enable = spyOn(client, "enableOrgPlugin");
const installPackage = spyOn(client, "installPluginPackage");
const reinstallOfficial = spyOn(client, "reinstallOfficialPlugin");
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
});

afterEach(() => {
  enable.mockReset();
  installPackage.mockReset();
  reinstallOfficial.mockReset();
  queryClient.clear();
});

afterAll(() => {
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
  test.each(["admin", "member"] as const)(
    "official reinstall is limited to admins: %s",
    (role) => {
      queryClient.setQueryData(["official-plugins"], {
        plugins: [
          {
            description: "",
            id: "workflows",
            name: "Workflows",
            version: "1.0.1",
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
      expect(html.includes(">Reinstall</button>")).toBe(role === "admin");
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
      expect(buttons).toEqual([...actions]);
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

  test("update and uninstall only while disabled; purge only while retained", () => {
    const enabled = plugin({
      availableVersions: ["1.0.0", "1.1.0"],
      lifecycleState: "enabled",
      selectedVersion: "1.0.0",
    });
    expect(pluginRowActions(enabled)).toEqual({
      disable: true,
      enable: false,
      purge: false,
      uninstall: false,
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
