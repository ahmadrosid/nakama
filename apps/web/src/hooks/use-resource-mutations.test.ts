import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { artifactShareStorageKey } from "@/lib/artifact-share-storage";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import {
  useConfigureProviderMutation,
  useCreateProviderMutation,
  useDeleteProviderMutation,
  useUpdateProviderMutation,
} from "./use-app-queries";
import { useUpdateProfileComposioToolkitsMutation } from "./use-composio";
import {
  useAddOrgMember,
  useInviteOrgMember,
  useRemoveOrgMember,
  useUpdateOrgMember,
} from "./use-org-members";
import { useDisableOrgPlugin, useEnableOrgPlugin } from "./use-plugins";
import {
  useArtifactsExist,
  useAssignToolMutation,
  useCloneProfileMutation,
  useConnectMcpServerMutation,
  useCreateMcpServerMutation,
  useCreateProfileMutation,
  useCreateSkillMutation,
  useDeleteMcpServerMutation,
  useDeleteProfileMutation,
  useDeleteSkillMutation,
  useDeleteToolMutation,
  useInstallSkillMutation,
  usePatchSkillMutation,
  useRevokeArtifactShareMutation,
  useSyncMcpServerMutation,
  useUnassignToolMutation,
  useUpdateMcpServerMutation,
  useUpdateProfileMutation,
} from "./use-resource-mutations";

const revoke = spyOn(client, "revokeProfileArtifactShare");

const publish = spyOn(client, "publishProfileArtifactShare");

const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
});

const variables = {
  path: "report.html",
  profileId: "profile",
  shareId: "old-share",
};

const queryKey = queryKeys.artifacts.shareStatus(
  variables.profileId,
  variables.path
);

test("cache updates invalidate matching keys and leave other organizations alone", async () => {
  const first = queryKeys.orgMemory("first");
  const second = queryKeys.orgMemory("second");
  const history = [...queryKeys.orgMemoryHistory("first"), "revision"];

  for (const key of [first, second, history]) {
    queryClient.setQueryData(key, { value: "saved" });
  }

  await invalidateQueries(
    queryClient,
    first,
    queryKeys.orgMemoryHistory("first")
  );

  expect(queryClient.getQueryState(first)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(history)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(second)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryData<{ value: string }>(second)).toEqual({
    value: "saved",
  });
});

test("cache updates start each refetch and wait for all updated data", async () => {
  const first = Promise.withResolvers<number>();
  const second = Promise.withResolvers<number>();
  const keys = [["first"], ["second"]];

  const stops = [first, second].map((pending, index) =>
    new QueryObserver(queryClient, {
      initialData: 0,
      queryFn: () => pending.promise,
      queryKey: keys[index],
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe(() => {})
  );

  try {
    let finished = false;

    const updating = invalidateQueries(queryClient, ...keys).then(() => {
      finished = true;
    });

    expect(
      keys.map((key) => queryClient.getQueryState(key)?.fetchStatus)
    ).toEqual(["fetching", "fetching"]);
    first.resolve(1);
    await first.promise;
    expect(finished).toBe(false);
    second.resolve(2);
    await updating;
    expect(keys.map((key) => queryClient.getQueryData(key))).toEqual([1, 2]);
  } finally {
    for (const stop of stops) {
      stop();
    }
  }
});

afterEach(() => {
  revoke.mockReset();
  publish.mockReset();
  queryClient.clear();
});

afterAll(() => {
  revoke.mockRestore();
  publish.mockRestore();
});

for (const kind of [
  "create",
  "update",
  "delete",
  "connect",
  "sync",
  "composio",
] as const) {
  test.each([false, true])(
    `${kind} integration refreshes shared readiness only on success; failure=%s`,
    async (fails) => {
      const server = {
        cachedTools: [{ description: "Search data", name: "search" }],
        config: { url: "https://example.com/mcp" },
        createdAt: "2026-10-12T00:00:00Z",
        enabled: true,
        id: "server",
        lastError: null,
        name: "Updated server",
        status: "connected" as const,
        toolCount: 1,
        transport: "http" as const,
        updatedAt: "2026-10-12T00:00:00Z",
        usesOAuth: false,
      };

      const create = spyOn(client, "createMcpServer").mockResolvedValue({
        server,
      });

      const update = spyOn(client, "updateMcpServer").mockResolvedValue({
        server,
      });

      const remove = spyOn(client, "deleteMcpServer").mockResolvedValue(
        undefined
      );

      const connect = spyOn(client, "connectMcpServer").mockResolvedValue({
        server,
      });

      const sync = spyOn(client, "syncMcpServer").mockResolvedValue({ server });

      const composio = spyOn(
        client,
        "updateProfileComposioToolkits"
      ).mockResolvedValue({ assignments: [] });

      const requests = [create, update, remove, connect, sync, composio];

      if (fails) {
        for (const request of requests) {
          request.mockRejectedValue(new Error("Retry integration change"));
        }
      }

      let createMutation!: ReturnType<typeof useCreateMcpServerMutation>;
      let updateMutation!: ReturnType<typeof useUpdateMcpServerMutation>;
      let deleteMutation!: ReturnType<typeof useDeleteMcpServerMutation>;
      let connectMutation!: ReturnType<typeof useConnectMcpServerMutation>;
      let syncMutation!: ReturnType<typeof useSyncMcpServerMutation>;

      let composioMutation!: ReturnType<
        typeof useUpdateProfileComposioToolkitsMutation
      >;

      function Probe() {
        createMutation = useCreateMcpServerMutation();
        updateMutation = useUpdateMcpServerMutation();
        deleteMutation = useDeleteMcpServerMutation();
        connectMutation = useConnectMcpServerMutation();
        syncMutation = useSyncMcpServerMutation();
        composioMutation = useUpdateProfileComposioToolkitsMutation();

        return null;
      }

      const keys = [
        queryKeys.organizationOverview("parent", "parent"),
        queryKeys.organizationOverview("parent", "team"),
        queryKeys.organizationPublicationCatalog("parent", "agent"),
        queryKeys.profiles.all,
        kind === "composio"
          ? queryKeys.composio.profileToolkits("profile")
          : queryKeys.mcp.all,
      ];

      const reads = keys.map(() => mock(async () => 2));

      const stops = keys.map((key, index) =>
        new QueryObserver(queryClient, {
          initialData: 1,
          queryFn: reads[index],
          queryKey: key,
          staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => {})
      );

      const memory = queryKeys.orgMemory("team");

      const otherAssignments =
        queryKeys.composio.profileToolkits("other-profile");

      const detail = queryKeys.mcp.detail(server.id);
      queryClient.setQueryData(memory, { content: "Private memory" });
      queryClient.setQueryData(otherAssignments, []);
      queryClient.setQueryData(detail, { ...server, name: "Old server" });

      const createInput = {
        config: server.config,
        name: server.name,
        transport: server.transport,
      };

      const updateInput = { enabled: false };

      const assignments = [
        { allowedActions: ["SEARCH"], toolkitId: "toolkit" },
      ];

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Probe)
          )
        );

        const operation =
          kind === "create"
            ? createMutation.mutateAsync(createInput)
            : kind === "update"
              ? updateMutation.mutateAsync({
                  request: updateInput,
                  serverId: server.id,
                })
              : kind === "delete"
                ? deleteMutation.mutateAsync({
                    force: false,
                    serverId: server.id,
                  })
                : kind === "connect"
                  ? connectMutation.mutateAsync(server.id)
                  : kind === "sync"
                    ? syncMutation.mutateAsync(server.id)
                    : composioMutation.mutateAsync({
                        assignments,
                        profileId: "profile",
                      });

        if (fails) {
          await expect(operation).rejects.toThrow();
        } else {
          await operation;
        }

        expect(keys.map((key) => queryClient.getQueryData(key))).toEqual(
          keys.map(() => (fails ? 1 : 2))
        );

        for (const read of reads) {
          expect(read).toHaveBeenCalledTimes(fails ? 0 : 1);
        }

        expect(queryClient.getQueryState(memory)?.isInvalidated).toBe(false);
        expect(queryClient.getQueryData<{ content: string }>(memory)).toEqual({
          content: "Private memory",
        });
        expect(queryClient.getQueryState(otherAssignments)?.isInvalidated).toBe(
          false
        );
        expect(queryClient.getQueryData<{ name: string }>(detail)?.name).toBe(
          fails || kind === "delete" || kind === "composio"
            ? "Old server"
            : server.name
        );

        if (kind === "create") {
          expect(create).toHaveBeenCalledWith(createInput);
        } else if (kind === "update") {
          expect(update).toHaveBeenCalledWith(server.id, updateInput);
        } else if (kind === "delete") {
          expect(remove).toHaveBeenCalledWith(server.id, false);
        } else if (kind === "connect") {
          expect(connect).toHaveBeenCalledWith(server.id);
        } else if (kind === "sync") {
          expect(sync).toHaveBeenCalledWith(server.id);
        } else {
          expect(composio).toHaveBeenCalledWith("profile", { assignments });
        }
      } finally {
        for (const stop of stops) {
          stop();
        }

        for (const request of requests) {
          request.mockRestore();
        }
      }
    }
  );
}

for (const kind of ["enable", "disable"] as const) {
  test.each([false, true])(
    `${kind} plugin refreshes shared catalogs only on success; failure=%s`,
    async (fails) => {
      const plugin = {
        actions: [],
        availableVersions: ["1.0.0"],
        databaseGeneration: null,
        description: "Shared tools",
        installed: true,
        lastLifecycleError: null,
        lifecycleState:
          kind === "enable" ? ("enabled" as const) : ("disabled" as const),
        name: "Plugin",
        pendingOperation: null,
        pluginId: "plugin",
        revision: 2,
        selectedVersion: "1.0.0",
        ui: null,
        updatedAt: "2026-10-12T00:00:00Z",
      };

      const enable = spyOn(client, "enableOrgPlugin").mockResolvedValue(plugin);

      const disable = spyOn(client, "disableOrgPlugin").mockResolvedValue(
        plugin
      );

      const requests = [enable, disable];

      if (fails) {
        for (const request of requests) {
          request.mockRejectedValue(new Error("Retry plugin change"));
        }
      }

      const action = mock(async () => {});

      const auth: AuthContextValue = {
        activeOrg: {
          createdAt: plugin.updatedAt,
          id: "parent",
          name: "Parent",
          role: "admin",
          slug: "parent",
          updatedAt: plugin.updatedAt,
        },
        archiveOrg: action,
        createOrg: action,
        isAuthenticated: true,
        isLoading: false,
        login: async () => ({ email: "admin@example.com", id: "admin" }),
        logout: action,
        orgs: [],
        platformOrgs: [],
        platformOrgsError: false,
        refreshPlatformOrgs: action,
        refreshSession: action,
        setup: action,
        switchOrg: action,
        updateOrg: action,
        user: {
          email: "admin@example.com",
          id: "admin",
          isPlatformAdmin: false,
        },
      };

      let mutation!: ReturnType<typeof useEnableOrgPlugin>;

      function Probe() {
        const enableMutation = useEnableOrgPlugin();
        const disableMutation = useDisableOrgPlugin();
        mutation = kind === "enable" ? enableMutation : disableMutation;

        return null;
      }

      const keys = [
        queryKeys.organizationOverview("parent", "parent"),
        queryKeys.organizationOverview("parent", "team"),
        queryKeys.organizationPublicationCatalog("parent", "tool"),
        queryKeys.organizationPublicationCatalog("parent", "skill"),
        queryKeys.plugins.all("parent"),
        queryKeys.tools.all,
        queryKeys.skills.all,
        queryKeys.profiles.all,
      ];

      const reads = keys.map(() => mock(async () => 2));

      const stops = keys.map((key, index) =>
        new QueryObserver(queryClient, {
          initialData: 1,
          queryFn: reads[index],
          queryKey: key,
          staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => {})
      );

      const memory = queryKeys.orgMemory("team");
      const otherPlugins = queryKeys.plugins.all("other");
      const inactive = queryKeys.organizationOverview("parent", "other-team");
      queryClient.setQueryData(memory, { content: "Private memory" });
      queryClient.setQueryData(otherPlugins, 1);
      queryClient.setQueryData(inactive, 1);

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(
              AuthContext.Provider,
              { value: auth },
              createElement(Probe)
            )
          )
        );

        const operation = mutation.mutateAsync({
          expectedRevision: 1,
          pluginId: plugin.pluginId,
        });

        if (fails) {
          await expect(operation).rejects.toThrow();
        } else {
          await operation;
        }

        expect(keys.map((key) => queryClient.getQueryData(key))).toEqual(
          keys.map(() => (fails ? 1 : 2))
        );

        for (const read of reads) {
          expect(read).toHaveBeenCalledTimes(fails ? 0 : 1);
        }

        expect(queryClient.getQueryState(inactive)?.isInvalidated).toBe(!fails);
        expect(queryClient.getQueryState(otherPlugins)?.isInvalidated).toBe(
          false
        );
        expect(queryClient.getQueryState(memory)?.isInvalidated).toBe(false);
        expect(queryClient.getQueryData<{ content: string }>(memory)).toEqual({
          content: "Private memory",
        });
        expect(kind === "enable" ? enable : disable).toHaveBeenCalledWith(
          plugin.pluginId,
          1,
          "parent"
        );
      } finally {
        for (const stop of stops) {
          stop();
        }

        for (const request of requests) {
          request.mockRestore();
        }
      }
    }
  );
}

for (const kind of [
  "create",
  "configure",
  "update",
  "delete",
  "tool",
] as const) {
  test.each([false, true])(
    `${kind} provider or tool refreshes shared catalogs only on success; failure=%s`,
    async (fails) => {
      const provider = {
        createdAt: "2026-10-12T00:00:00Z",
        hasApiKey: true,
        id: "provider",
        label: "New provider label",
        modelCount: 1,
        type: "openai" as const,
      };

      const create = spyOn(client, "createProvider").mockResolvedValue({
        defaultProviderId: provider.id,
        initialModel: "provider::model",
        provider,
      });

      const configure = spyOn(client, "configureProvider").mockResolvedValue({
        currentModel: "provider::model",
        displayName: provider.label,
        provider: provider.type,
      });

      const update = spyOn(client, "updateProvider").mockResolvedValue({
        provider,
      });

      const remove = spyOn(client, "deleteProvider").mockResolvedValue({
        defaultProviderId: null,
      });

      const deleteTool = spyOn(client, "deleteTool").mockResolvedValue(
        undefined
      );

      const requests = [create, configure, update, remove, deleteTool];

      if (fails) {
        for (const request of requests) {
          request.mockRejectedValue(new Error("Retry source change"));
        }
      }

      let createMutation!: ReturnType<typeof useCreateProviderMutation>;
      let configureMutation!: ReturnType<typeof useConfigureProviderMutation>;
      let updateMutation!: ReturnType<typeof useUpdateProviderMutation>;
      let deleteMutation!: ReturnType<typeof useDeleteProviderMutation>;
      let deleteToolMutation!: ReturnType<typeof useDeleteToolMutation>;

      function Probe() {
        createMutation = useCreateProviderMutation();
        configureMutation = useConfigureProviderMutation();
        updateMutation = useUpdateProviderMutation();
        deleteMutation = useDeleteProviderMutation();
        deleteToolMutation = useDeleteToolMutation();

        return null;
      }

      const keys = [
        queryKeys.organizationOverview("parent", "parent"),
        queryKeys.organizationOverview("parent", "team"),
        queryKeys.organizationPublicationCatalog(
          "parent",
          kind === "tool" ? "tool" : "model"
        ),
        ...(kind === "tool"
          ? [queryKeys.tools.all, queryKeys.profiles.all]
          : [queryKeys.models, queryKeys.providers, queryKeys.health]),
      ];

      const reads = keys.map(() => mock(async () => 2));

      const stops = keys.map((key, index) =>
        new QueryObserver(queryClient, {
          initialData: 1,
          queryFn: reads[index],
          queryKey: key,
          staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => {})
      );

      const inactive = queryKeys.organizationOverview("parent", "other-team");
      const memory = queryKeys.orgMemory("team");
      const source = queryKeys.tools.source("tool");
      queryClient.setQueryData(inactive, 1);
      queryClient.setQueryData(memory, { content: "Private memory" });
      queryClient.setQueryData(source, "Old source");

      const createInput = {
        apiKey: "test-key",
        label: provider.label,
        type: provider.type,
      };

      const configureInput = { apiKey: "test-key", provider: provider.type };
      const updateInput = { label: provider.label };

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Probe)
          )
        );

        const operation =
          kind === "create"
            ? createMutation.mutateAsync(createInput)
            : kind === "configure"
              ? configureMutation.mutateAsync(configureInput)
              : kind === "update"
                ? updateMutation.mutateAsync({
                    providerId: provider.id,
                    request: updateInput,
                  })
                : kind === "delete"
                  ? deleteMutation.mutateAsync(provider.id)
                  : deleteToolMutation.mutateAsync("tool");

        if (fails) {
          await expect(operation).rejects.toThrow();
        } else {
          await operation;
        }

        expect(keys.map((key) => queryClient.getQueryData(key))).toEqual(
          keys.map(() => (fails ? 1 : 2))
        );

        for (const read of reads) {
          expect(read).toHaveBeenCalledTimes(fails ? 0 : 1);
        }

        expect(queryClient.getQueryState(inactive)?.isInvalidated).toBe(!fails);
        expect(queryClient.getQueryState(memory)?.isInvalidated).toBe(false);
        expect(queryClient.getQueryData<{ content: string }>(memory)).toEqual({
          content: "Private memory",
        });
        expect(queryClient.getQueryState(source)?.isInvalidated).toBe(
          kind === "tool" && !fails
        );

        if (kind === "create") {
          expect(create).toHaveBeenCalledWith(createInput);
        } else if (kind === "configure") {
          expect(configure).toHaveBeenCalledWith(configureInput);
        } else if (kind === "update") {
          expect(update).toHaveBeenCalledWith(provider.id, updateInput);
        } else if (kind === "delete") {
          expect(remove).toHaveBeenCalledWith(provider.id);
        } else {
          expect(deleteTool).toHaveBeenCalledWith("tool");
        }
      } finally {
        for (const stop of stops) {
          stop();
        }

        for (const request of requests) {
          request.mockRestore();
        }
      }
    }
  );
}

for (const kind of ["create", "install", "patch", "delete"] as const) {
  test.each([false, true])(
    `${kind} skill refreshes shared catalogs only on success; failure=%s`,
    async (fails) => {
      const skill = {
        body: "Updated skill",
        createdAt: "2026-10-12T00:00:00Z",
        createdBy: "human" as const,
        description: "Review content",
        disableModelInvocation: false,
        enabled: true,
        hasTool: false,
        id: "skill",
        name: "Content review",
        orgId: "parent",
        scriptIssues: [],
        sourcePath: "/tmp/nakama-test-skills/content-review/SKILL.md",
        updatedAt: "2026-10-12T00:00:00Z",
      };

      const create = spyOn(client, "createSkill").mockResolvedValue({ skill });

      const install = spyOn(client, "installSkill").mockResolvedValue({
        skill,
      });

      const patch = spyOn(client, "patchSkill").mockResolvedValue({ skill });
      const remove = spyOn(client, "deleteSkill").mockResolvedValue(undefined);
      const requests = [create, install, patch, remove];

      if (fails) {
        for (const request of requests) {
          request.mockRejectedValue(new Error("Retry skill change"));
        }
      }

      let createMutation!: ReturnType<typeof useCreateSkillMutation>;
      let installMutation!: ReturnType<typeof useInstallSkillMutation>;
      let patchMutation!: ReturnType<typeof usePatchSkillMutation>;
      let deleteMutation!: ReturnType<typeof useDeleteSkillMutation>;

      function Probe() {
        createMutation = useCreateSkillMutation();
        installMutation = useInstallSkillMutation();
        patchMutation = usePatchSkillMutation();
        deleteMutation = useDeleteSkillMutation();

        return null;
      }

      const keys = [
        queryKeys.organizationOverview("parent", "parent"),
        queryKeys.organizationOverview("parent", "team"),
        queryKeys.organizationPublicationCatalog("parent", "skill"),
        queryKeys.skills.all,
      ];

      const reads = keys.map(() => mock(async () => 2));

      const stops = keys.map((key, index) =>
        new QueryObserver(queryClient, {
          initialData: 1,
          queryFn: reads[index],
          queryKey: key,
          staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => {})
      );

      const inactive = queryKeys.organizationOverview("parent", "other-team");
      const memory = queryKeys.orgMemory("team");
      queryClient.setQueryData(inactive, 1);
      queryClient.setQueryData(memory, { content: "Private memory" });
      queryClient.setQueryData(queryKeys.skills.detail(skill.id), {
        ...skill,
        body: "Old skill",
      });

      const createInput = {
        description: skill.description,
        name: skill.name,
        profileId: "profile",
      };

      const installInput = {
        profileId: "profile",
        url: "https://example.com/skill.zip",
      };

      const patchInput = { body: skill.body };

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Probe)
          )
        );

        const operation =
          kind === "create"
            ? createMutation.mutateAsync(createInput)
            : kind === "install"
              ? installMutation.mutateAsync(installInput)
              : kind === "patch"
                ? patchMutation.mutateAsync({
                    input: patchInput,
                    profileId: "profile",
                    skillId: skill.id,
                  })
                : deleteMutation.mutateAsync(skill.id);

        if (fails) {
          await expect(operation).rejects.toThrow();
        } else {
          await operation;
        }

        expect(keys.map((key) => queryClient.getQueryData(key))).toEqual(
          fails ? [1, 1, 1, 1] : [2, 2, 2, 2]
        );

        for (const read of reads) {
          expect(read).toHaveBeenCalledTimes(fails ? 0 : 1);
        }

        expect(queryClient.getQueryState(inactive)?.isInvalidated).toBe(!fails);
        expect(queryClient.getQueryState(memory)?.isInvalidated).toBe(false);
        expect(queryClient.getQueryData<{ content: string }>(memory)).toEqual({
          content: "Private memory",
        });

        if (kind === "create") {
          expect(create).toHaveBeenCalledWith(createInput);
        } else if (kind === "install") {
          expect(install).toHaveBeenCalledWith(installInput);
        } else if (kind === "patch") {
          expect(patch).toHaveBeenCalledWith(skill.id, patchInput, {
            profileId: "profile",
          });
          expect(
            queryClient.getQueryData<{ body: string }>(
              queryKeys.skills.detail(skill.id)
            )?.body
          ).toBe(fails ? "Old skill" : skill.body);
        } else {
          expect(remove).toHaveBeenCalledWith(skill.id);
        }
      } finally {
        for (const stop of stops) {
          stop();
        }

        for (const request of requests) {
          request.mockRestore();
        }
      }
    }
  );
}

for (const kind of ["create", "clone", "update", "delete"] as const) {
  test.each([false, true])(
    `${kind} profile refreshes shared catalogs only on success; failure=%s`,
    async (fails) => {
      const profile = {
        createdAt: "2026-10-12T00:00:00Z",
        hasAvatar: false,
        id: "profile",
        isSuper: false,
        mcpServerCount: 0,
        mcpServers: [],
        model: null,
        name: "Updated agent",
        skills: [],
        soulActive: false,
        systemPrompt: "",
        toolCount: 0,
        tools: [],
        updatedAt: "2026-10-12T00:00:00Z",
      };

      const create = spyOn(client, "createProfile").mockResolvedValue({
        profile,
      });

      const clone = spyOn(client, "cloneProfile").mockResolvedValue({
        profile,
      });

      const update = spyOn(client, "updateProfile").mockResolvedValue({
        profile,
      });

      const remove = spyOn(client, "deleteProfile").mockResolvedValue(
        undefined
      );

      const requests = [create, clone, update, remove];

      if (fails) {
        for (const request of requests) {
          request.mockRejectedValue(new Error("Retry profile change"));
        }
      }

      let createMutation!: ReturnType<typeof useCreateProfileMutation>;
      let cloneMutation!: ReturnType<typeof useCloneProfileMutation>;
      let updateMutation!: ReturnType<typeof useUpdateProfileMutation>;
      let deleteMutation!: ReturnType<typeof useDeleteProfileMutation>;

      function Probe() {
        createMutation = useCreateProfileMutation();
        cloneMutation = useCloneProfileMutation();
        updateMutation = useUpdateProfileMutation();
        deleteMutation = useDeleteProfileMutation();

        return null;
      }

      const keys = [
        queryKeys.organizationOverview("parent", "parent"),
        queryKeys.organizationOverview("parent", "team"),
        queryKeys.organizationPublicationCatalog("parent", "agent"),
        queryKeys.profiles.all,
      ];

      const reads = keys.map(() => mock(async () => 2));

      const stops = keys.map((key, index) =>
        new QueryObserver(queryClient, {
          initialData: 1,
          queryFn: reads[index],
          queryKey: key,
          staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => {})
      );

      const inactive = queryKeys.organizationOverview("parent", "other-team");
      const memory = queryKeys.orgMemory("team");
      queryClient.setQueryData(inactive, 1);
      queryClient.setQueryData(memory, { content: "Private memory" });

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Probe)
          )
        );

        const operation =
          kind === "create"
            ? createMutation.mutateAsync({ name: profile.name })
            : kind === "clone"
              ? cloneMutation.mutateAsync(profile.id)
              : kind === "update"
                ? updateMutation.mutateAsync({
                    input: { name: profile.name },
                    profileId: profile.id,
                  })
                : deleteMutation.mutateAsync(profile.id);

        if (fails) {
          await expect(operation).rejects.toThrow();
        } else {
          await operation;
        }

        expect(keys.map((key) => queryClient.getQueryData(key))).toEqual(
          fails ? [1, 1, 1, 1] : [2, 2, 2, 2]
        );

        for (const read of reads) {
          expect(read).toHaveBeenCalledTimes(fails ? 0 : 1);
        }

        expect(queryClient.getQueryState(inactive)?.isInvalidated).toBe(!fails);
        expect(queryClient.getQueryState(memory)?.isInvalidated).toBe(false);
        expect(queryClient.getQueryData<{ content: string }>(memory)).toEqual({
          content: "Private memory",
        });

        if (kind === "create") {
          expect(create).toHaveBeenCalledWith({ name: profile.name });
        } else if (kind === "clone") {
          expect(clone).toHaveBeenCalledWith(profile.id);
        } else if (kind === "update") {
          expect(update).toHaveBeenCalledWith(profile.id, {
            name: profile.name,
          });
        } else {
          expect(remove).toHaveBeenCalledWith(profile.id);
        }
      } finally {
        for (const stop of stops) {
          stop();
        }

        for (const request of requests) {
          request.mockRestore();
        }
      }
    }
  );
}

test.each([false, true])(
  "automations toggle moves the cached profile before the save returns; failure=%s",
  async (fails) => {
    const profile = { automationsEnabled: false, id: "profile_toggle" };
    const other = { automationsEnabled: false, id: "profile_other" };
    const detailKey = queryKeys.profiles.detail(profile.id);
    const save = Promise.withResolvers<{ profile: never }>();

    const update = spyOn(client, "updateProfile").mockReturnValue(save.promise);

    queryClient.setQueryData(detailKey, profile);
    queryClient.setQueryData(queryKeys.profiles.all, [profile, other]);

    let updateMutation!: ReturnType<typeof useUpdateProfileMutation>;

    function Probe() {
      updateMutation = useUpdateProfileMutation();

      return null;
    }

    try {
      renderToString(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe)
        )
      );

      const operation = updateMutation.mutateAsync({
        input: { automationsEnabled: true },
        profileId: profile.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(queryClient.getQueryData(detailKey)).toEqual({
        ...profile,
        automationsEnabled: true,
      });
      expect(queryClient.getQueryData(queryKeys.profiles.all)).toEqual([
        { ...profile, automationsEnabled: true },
        other,
      ]);

      if (fails) {
        save.reject(new Error("Retry toggle"));
        await expect(operation).rejects.toThrow();
      } else {
        // SAFETY: The hook ignores the saved profile; only the cache is checked.
        save.resolve({ profile: undefined as never });
        await operation;
      }

      const expected = fails
        ? profile
        : { ...profile, automationsEnabled: true };

      expect(queryClient.getQueryData(detailKey)).toEqual(expected);
      expect(queryClient.getQueryData(queryKeys.profiles.all)).toEqual([
        expected,
        other,
      ]);
    } finally {
      update.mockRestore();
      queryClient.removeQueries({ queryKey: queryKeys.profiles.all });
    }
  }
);

for (const kind of ["add", "invite", "update", "remove"] as const) {
  test.each([false, true])(
    `${kind} member refreshes summaries only on success; failure=%s`,
    async (fails) => {
      const member = {
        createdAt: "2026-10-12T00:00:00Z",
        email: "member@example.com",
        name: "Member",
        phone: null,
        role: "member" as const,
        userId: "member",
      };

      const add = spyOn(client, "addOrgMember").mockResolvedValue({
        member,
        temporaryPassword: null,
      });

      const invite = spyOn(client, "inviteOrgMember").mockResolvedValue({
        delivered: true,
        invite: {
          createdAt: member.createdAt,
          email: member.email,
          expiresAt: "2026-10-19T00:00:00Z",
          id: "invite",
          orgId: "team",
          role: "member",
        },
        token: null,
      });

      const update = spyOn(client, "updateOrgMember").mockResolvedValue({
        member,
      });

      const remove = spyOn(client, "removeOrgMember").mockResolvedValue(
        undefined
      );

      const requests = [add, invite, update, remove];

      if (fails) {
        for (const request of requests) {
          request.mockRejectedValue(new Error("Retry member change"));
        }
      }

      let addMutation!: ReturnType<typeof useAddOrgMember>;
      let inviteMutation!: ReturnType<typeof useInviteOrgMember>;
      let updateMutation!: ReturnType<typeof useUpdateOrgMember>;
      let removeMutation!: ReturnType<typeof useRemoveOrgMember>;

      function Probe() {
        addMutation = useAddOrgMember("team");
        inviteMutation = useInviteOrgMember("team");
        updateMutation = useUpdateOrgMember("team");
        removeMutation = useRemoveOrgMember("team");

        return null;
      }

      const summaryKeys = [
        queryKeys.organizationOverview("parent", "parent"),
        queryKeys.organizationOverview("parent", "team"),
      ];

      const reads = summaryKeys.map(() => mock(async () => 15));

      const stops = summaryKeys.map((key, index) =>
        new QueryObserver(queryClient, {
          initialData: 14,
          queryFn: reads[index],
          queryKey: key,
          staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => {})
      );

      const membersKey = queryKeys.orgMembers("team");
      const otherMembers = queryKeys.orgMembers("other");
      const otherMemory = queryKeys.orgMemory("other");
      queryClient.setQueryData(membersKey, { members: [] });
      queryClient.setQueryData(otherMembers, { members: [] });
      queryClient.setQueryData(otherMemory, { content: "Private memory" });

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Probe)
          )
        );

        const operation =
          kind === "add"
            ? addMutation.mutateAsync({
                email: member.email,
                name: member.name,
                role: "member",
              })
            : kind === "invite"
              ? inviteMutation.mutateAsync({
                  email: member.email,
                  role: "member",
                })
              : kind === "update"
                ? updateMutation.mutateAsync({
                    request: { role: "member" },
                    userId: member.userId,
                  })
                : removeMutation.mutateAsync(member.userId);

        if (fails) {
          await expect(operation).rejects.toThrow();
        } else {
          await operation;
        }

        expect(queryClient.getQueryState(membersKey)?.isInvalidated).toBe(
          !fails
        );
        expect(summaryKeys.map((key) => queryClient.getQueryData(key))).toEqual(
          fails ? [14, 14] : [15, 15]
        );

        for (const read of reads) {
          expect(read).toHaveBeenCalledTimes(fails ? 0 : 1);
        }

        expect(queryClient.getQueryState(otherMembers)?.isInvalidated).toBe(
          false
        );
        expect(queryClient.getQueryState(otherMemory)?.isInvalidated).toBe(
          false
        );
        expect(
          queryClient.getQueryData<{ content: string }>(otherMemory)
        ).toEqual({
          content: "Private memory",
        });

        if (kind === "add") {
          expect(add).toHaveBeenCalledWith("team", {
            email: member.email,
            name: member.name,
            role: "member",
          });
        } else if (kind === "invite") {
          expect(invite).toHaveBeenCalledWith("team", {
            email: member.email,
            role: "member",
          });
        } else if (kind === "update") {
          expect(update).toHaveBeenCalledWith("team", member.userId, {
            role: "member",
          });
        } else {
          expect(remove).toHaveBeenCalledWith("team", member.userId);
        }
      } finally {
        for (const stop of stops) {
          stop();
        }

        for (const request of requests) {
          request.mockRestore();
        }
      }
    }
  );
}

function renderMutation() {
  let mutation: ReturnType<typeof useRevokeArtifactShareMutation>;

  function Probe() {
    mutation = useRevokeArtifactShareMutation();

    return null;
  }

  renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Probe)
    )
  );

  return () => mutation.mutateAsync(variables);
}

test.each([200, 404])(
  "revoke completes and invalidates stale share status on HTTP %s",
  async (status) => {
    queryClient.setQueryData(queryKey, { active: true, id: variables.shareId });

    if (status === 404) {
      revoke.mockRejectedValue(new NakamaApiError("Not found", 404));
    } else {
      revoke.mockResolvedValue({ id: variables.shareId, revoked: true });
    }

    const mutate = renderMutation();
    await expect(mutate()).resolves.toEqual({
      id: variables.shareId,
      revoked: status === 200,
    });
    expect(revoke).toHaveBeenCalledWith(variables.profileId, variables.shareId);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  }
);

test("revoke preserves HTTP 403 failures rather than allowing rotation to continue", async () => {
  queryClient.setQueryData(queryKey, { active: true, id: variables.shareId });
  const error = new NakamaApiError("Request failed", 403);
  revoke.mockRejectedValue(error);

  const mutate = renderMutation();
  await expect(mutate()).rejects.toBe(error);
  expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
});

describe("artifact share controls with a stale share ID", () => {
  const unusedAuthAction = mock(async () => {});

  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "2026-09-06T00:00:00Z",
      id: "org",
      name: "Test",
      role: "admin",
      slug: "test",
      updatedAt: "2026-09-06T00:00:00Z",
    },
    archiveOrg: unusedAuthAction,
    createOrg: unusedAuthAction,
    isAuthenticated: true,
    isLoading: false,
    login: async () => ({ email: "admin@example.com", id: "admin" }),
    logout: unusedAuthAction,
    orgs: [],
    platformOrgs: [],
    platformOrgsError: false,
    refreshPlatformOrgs: unusedAuthAction,
    refreshSession: unusedAuthAction,
    setup: unusedAuthAction,
    switchOrg: unusedAuthAction,
    updateOrg: unusedAuthAction,
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
  };

  const storageKey = artifactShareStorageKey(
    "admin",
    "org",
    variables.profileId,
    variables.path
  );

  const store = new Map<string, string>();
  let previousLocalStorage: Storage;

  beforeEach(() => {
    previousLocalStorage = globalThis.localStorage;
    store.clear();
    store.set(
      storageKey,
      JSON.stringify({
        shareId: variables.shareId,
        shareUrl: "https://example.com/s/old",
      })
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    queryClient.setQueryData(queryKey, { active: true, id: variables.shareId });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousLocalStorage,
    });
  });

  function renderControls() {
    let controls: ReturnType<typeof useArtifactShareControls>;

    function Probe() {
      controls = useArtifactShareControls({
        artifactPath: variables.path,
        profileId: variables.profileId,
      });

      return null;
    }

    renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          AuthContext.Provider,
          { value: auth },
          createElement(Probe)
        )
      )
    );

    return {
      revoke: () => controls.handleRevoke(),
      rotate: () => controls.handleRotateLink(),
    };
  }

  test.each(["rotate", "revoke"] as const)(
    "%s leaves a replacement share alone when the old ID returns 404",
    async (action) => {
      const replacement = { active: true, id: "replacement-share" };
      revoke.mockImplementation(() => {
        queryClient.setQueryData(queryKey, replacement);

        return Promise.reject(new NakamaApiError("Not found", 404));
      });
      publish.mockResolvedValue({
        id: replacement.id,
        refreshed: true,
        sharePath: "",
        shareUrl: null,
        token: "",
        webPublicUrlConfigured: true,
      });

      await renderControls()[action]();

      expect(revoke).toHaveBeenCalledWith(
        variables.profileId,
        variables.shareId
      );
      expect(publish).not.toHaveBeenCalled();
      expect(store.has(storageKey)).toBe(false);
      expect(queryClient.getQueryData<typeof replacement>(queryKey)).toEqual(
        replacement
      );
    }
  );

  test("rotation still publishes after successfully revoking the current link", async () => {
    revoke.mockResolvedValue({ id: variables.shareId, revoked: true });
    publish.mockResolvedValue({
      id: "new-share",
      refreshed: false,
      sharePath: "/s/new",
      shareUrl: "https://example.com/s/new",
      token: "new",
      webPublicUrlConfigured: true,
    });

    await renderControls().rotate();

    expect(publish).toHaveBeenCalledWith(variables.profileId, variables.path);
    expect(JSON.parse(store.get(storageKey) ?? "null")).toEqual({
      shareId: "new-share",
      shareUrl: "https://example.com/s/new",
    });
  });

  test("rotation does not clear or publish on a permission failure", async () => {
    revoke.mockRejectedValue(new NakamaApiError("Forbidden", 403));

    await renderControls().rotate();

    expect(publish).not.toHaveBeenCalled();
    expect(store.has(storageKey)).toBe(true);
  });

  test("does not recover account A share after logout and account B login", async () => {
    const accountA = { ...auth, user: { ...auth.user!, id: "account-a" } };
    const accountB = { ...auth, user: { ...auth.user!, id: "account-b" } };

    const accountAStorageKey = artifactShareStorageKey(
      "account-a",
      "org",
      variables.profileId,
      variables.path
    );

    store.set(
      accountAStorageKey,
      JSON.stringify({
        shareId: variables.shareId,
        shareUrl: "https://example.com/s/account-a",
      })
    );
    queryClient.setQueryData(queryKey, { active: false });

    const container = document.createElement("div");
    const root = createRoot(container);
    let controls: ReturnType<typeof useArtifactShareControls>;
    const observedShares: boolean[] = [];

    function Probe() {
      controls = useArtifactShareControls({
        artifactPath: variables.path,
        profileId: variables.profileId,
      });
      observedShares.push(controls.isShared);

      return null;
    }

    const render = (value: AuthContextValue) =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AuthContext.Provider, { value }, createElement(Probe))
        )
      );

    try {
      await act(async () => render(accountA));
      await act(async () => controls.openViewShareDialog());
      expect(controls!.publishedUrl).toBe("https://example.com/s/account-a");

      observedShares.length = 0;
      await act(async () => render(accountB));
      expect(observedShares[0]).toBe(false);

      await act(async () =>
        render({ ...accountA, activeOrg: null, user: null })
      );
      await act(async () => render(accountB));
      await act(async () => controls.openViewShareDialog());

      expect(controls!.publishedUrl).toBeNull();
      expect(controls!.isShared).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

test.each(["assign", "unassign"])(
  "plugin %s waits for the whole batch and refreshes partial failures",
  async (mode) => {
    const spy =
      mode === "assign"
        ? spyOn(client, "assignTool")
        : spyOn(client, "unassignTool");

    let release!: (value: never) => void;
    let started!: () => void;

    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });

    const error = new Error("One action was rejected");
    spy.mockRejectedValueOnce(error);
    spy.mockImplementationOnce(() => {
      started();

      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const key = queryKeys.profiles.detail("profile");
    queryClient.setQueryData(key, { id: "profile" });
    let mutation!: ReturnType<typeof useAssignToolMutation>;

    function Probe() {
      const assign = useAssignToolMutation();
      const unassign = useUnassignToolMutation();
      mutation = mode === "assign" ? assign : unassign;

      return null;
    }

    renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe)
      )
    );

    try {
      let settled = false;

      const result = mutation
        .mutateAsync({ profileId: "profile", toolId: ["first", "second"] })
        .catch((failure) => {
          settled = true;

          return failure;
        });

      await waiting;
      expect(settled).toBe(false);
      // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
      release({} as never);
      expect(await result).toBe(error);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    } finally {
      spy.mockRestore();
    }
  }
);

test("useArtifactsExist hides only the artifacts the server reports missing", async () => {
  const exists = spyOn(client, "hasProfileArtifact").mockImplementation(
    async (_profileId, path) => {
      if (path === "gone.md") {
        return false;
      }

      if (path === "flaky.md") {
        throw new NakamaApiError("Bad gateway", 502);
      }

      return true;
    }
  );

  const existsClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let result: boolean[] = [];

  function Probe() {
    result = useArtifactsExist(
      [
        { path: "kept.md" },
        { path: "gone.md" },
        { path: "flaky.md" },
        { ownerProfileId: "other", path: "shared.md" },
      ],
      "profile",
      true
    );

    return null;
  }

  const render = () =>
    renderToString(
      createElement(
        QueryClientProvider,
        { client: existsClient },
        createElement(Probe)
      )
    );

  try {
    render();
    // Nothing is known yet, so every chip stays.
    expect(result).toEqual([true, true, true, true]);

    // A server render registers the queries without running them.
    await Promise.allSettled(
      existsClient
        .getQueryCache()
        .getAll()
        .map((query) => query.fetch())
    );
    render();

    expect(result).toEqual([true, false, true, true]);
    expect(exists.mock.calls).toContainEqual(["other", "shared.md"]);
  } finally {
    exists.mockRestore();
    existsClient.clear();
  }
});
