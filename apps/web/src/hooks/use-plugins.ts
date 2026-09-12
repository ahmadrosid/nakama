import { NakamaApiError } from "@nakama/core/api-error";
import type {
  DeleteRetainedPluginDataRequest,
  InstallPluginPackageRequest,
  OrgPluginDetail,
  PluginPackagePreviewResponse,
  PluginPackageRequest,
  ProfileDetail,
  SkillSummary,
  ToolSummary,
  UpdateOrgPluginRequest,
} from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { client } from "@/lib/client";
import { canAccessIntegrationsPage } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";

export type PluginPageViewKind =
  | "loading"
  | "unauthorized"
  | "disabled"
  | "unavailable"
  | "failed"
  | "page";

export function isPluginOwned(resource: { pluginId?: string | null }): boolean {
  return Boolean(resource.pluginId);
}

/** Group plugin actions for one-click profile assignment, retaining their IDs. */
export function groupPluginTools(tools: ToolSummary[]) {
  const groups = new Map<string, { tool: ToolSummary; tools: ToolSummary[] }>();
  for (const tool of tools) {
    const key = tool.pluginId ? `plugin:${tool.pluginId}` : `tool:${tool.id}`;
    const group = groups.get(key);
    if (group) {
      group.tools.push(tool);
    } else {
      groups.set(key, { tool, tools: [tool] });
    }
  }
  return [...groups.values()];
}

export function pluginAgentAccessState(
  profile: ProfileDetail,
  pluginId: string,
  resources: { tools: ToolSummary[]; skills: SkillSummary[] }
) {
  const tools = resources.tools.filter((tool) => tool.pluginId === pluginId);
  const skills = resources.skills.filter(
    (skill) => skill.pluginId === pluginId
  );
  const assigned =
    tools.filter((tool) => profile.tools.some((item) => item.id === tool.id))
      .length +
    skills.filter((skill) =>
      profile.skills.some((item) => item.id === skill.id)
    ).length;
  const total = tools.length + skills.length;
  return { assigned, full: total > 0 && assigned === total, total };
}

export function usePluginAgentAccess() {
  const { activeOrg, user } = useAuth();
  const orgId = activeOrg?.id ?? "";
  return useQuery({
    enabled: Boolean(orgId) && user?.isPlatformAdmin === true,
    queryFn: async () => {
      const [list, tools, skills] = await Promise.all([
        client.listProfiles(orgId),
        client.listTools(orgId),
        client.listSkills(orgId),
      ]);
      const profiles = await Promise.all(
        list.profiles.map(
          async (profile) =>
            (await client.getProfile(profile.id, orgId)).profile
        )
      );
      const resources = { skills: skills.skills, tools: tools.tools };
      const pluginIds = [
        ...new Set(
          [...resources.tools, ...resources.skills].flatMap((item) =>
            item.pluginId ? [item.pluginId] : []
          )
        ),
      ];
      const counts = Object.fromEntries(
        pluginIds.map((id) => [
          id,
          profiles.filter(
            (profile) =>
              pluginAgentAccessState(profile, id, resources).assigned > 0
          ).length,
        ])
      );
      return { profiles, ...resources, counts };
    },
    queryKey: [...queryKeys.profiles.all, "plugin-access", orgId],
  });
}

export async function savePluginAgentAccess(
  orgId: string,
  pluginId: string,
  changes: Record<string, boolean>
) {
  const [plugin, tools, skills] = await Promise.all([
    client.getOrgPlugin(pluginId, orgId),
    client.listTools(orgId),
    client.listSkills(orgId),
  ]);
  if (plugin.lifecycleState !== "enabled") {
    throw new Error("Enable this plugin before changing agent access.");
  }
  const pluginTools = tools.tools.filter((item) => item.pluginId === pluginId);
  const pluginSkills = skills.skills.filter(
    (item) => item.pluginId === pluginId
  );
  const results = await Promise.allSettled(
    Object.entries(changes).map(async ([profileId, selected]) => {
      const { profile } = await client.getProfile(profileId, orgId);
      const operations = [
        ...pluginTools.flatMap((tool) => {
          if (selected === profile.tools.some((item) => item.id === tool.id)) {
            return [];
          }
          return [
            selected
              ? client.assignTool(profileId, { toolId: tool.id }, orgId)
              : client.unassignTool(profileId, tool.id, orgId),
          ];
        }),
        ...pluginSkills.flatMap((skill) => {
          if (
            selected === profile.skills.some((item) => item.id === skill.id)
          ) {
            return [];
          }
          return [
            selected
              ? client.assignSkill(profileId, { skillId: skill.id }, orgId)
              : client.unassignSkill(profileId, skill.id, orgId),
          ];
        }),
      ];
      const outcomes = await Promise.allSettled(operations);
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure?.status === "rejected") {
        throw failure.reason;
      }
    })
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
}

export function useSavePluginAgentAccess() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      pluginId,
      changes,
    }: {
      pluginId: string;
      changes: Record<string, boolean>;
    }) => savePluginAgentAccess(orgId, pluginId, changes),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
  });
}

export function orgPluginsQueryOptions(orgId: string) {
  return queryOptions({
    queryFn: () => client.listOrgPlugins(orgId),
    queryKey: queryKeys.plugins.all(orgId),
  });
}

export function orgPluginQueryOptions(orgId: string, pluginId: string) {
  return queryOptions({
    queryFn: () => client.getOrgPlugin(pluginId, orgId),
    queryKey: queryKeys.plugins.detail(orgId, pluginId),
  });
}

function pluginReleasesQueryOptions() {
  return queryOptions({
    queryFn: () => client.listPluginReleases(),
    queryKey: queryKeys.plugins.releases,
  });
}

export function useOrgPlugins() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const allowed = canAccessIntegrationsPage(activeOrg?.role);

  return useQuery({
    ...orgPluginsQueryOptions(orgId),
    enabled: Boolean(orgId) && allowed,
    select: (data) => data.plugins,
  });
}

export function useOfficialPlugins() {
  return useQuery({
    queryFn: () => client.listOfficialPlugins(),
    queryKey: ["official-plugins"],
  });
}

export function useInstallOfficialPlugin() {
  return usePluginMutation(
    (pluginId: string, orgId) => client.installOfficialPlugin(pluginId, orgId),
    async ({ orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.releases,
      });
    }
  );
}

export function useReinstallOfficialPlugin() {
  const queryClient = useQueryClient();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  return useMutation({
    mutationFn: (input: { pluginId: string; expectedRevision: number }) =>
      client.reinstallOfficialPlugin(
        input.pluginId,
        input.expectedRevision,
        orgId
      ),
    onMutate: () => ({ orgId }),
    onSettled: async (_data, _error, _variables, context) => {
      await invalidateOrgPlugins(queryClient, context?.orgId ?? orgId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.releases,
      });
    },
  });
}

export function useOrgPlugin(pluginId: string | undefined) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const allowed = canAccessIntegrationsPage(activeOrg?.role);

  return useQuery({
    ...orgPluginQueryOptions(orgId, pluginId ?? ""),
    enabled: Boolean(orgId && pluginId) && allowed,
  });
}

export function usePluginReleases(enabled: boolean) {
  return useQuery({
    ...pluginReleasesQueryOptions(),
    enabled,
  });
}

function invalidateOrgPlugins(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all(orgId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.tools.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
  ]);
}

function usePluginMutation<TVariables, TData>(
  mutationFn: (variables: TVariables, orgId: string) => Promise<TData>,
  onSuccess?: (input: {
    data: TData;
    orgId: string;
    queryClient: ReturnType<typeof useQueryClient>;
    variables: TVariables;
  }) => Promise<void>
) {
  const queryClient = useQueryClient();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";

  return useMutation({
    mutationFn: (variables: TVariables) => mutationFn(variables, orgId),
    onSuccess: onSuccess
      ? async (data, variables) => {
          await onSuccess({ data, orgId, queryClient, variables });
        }
      : undefined,
  });
}

export function usePreviewPluginPackage() {
  return usePluginMutation((request: PluginPackageRequest) =>
    client.previewPluginPackage(request)
  );
}

export function useInstallPluginPackage() {
  return usePluginMutation(
    (request: InstallPluginPackageRequest) =>
      client.installPluginPackage(request),
    async ({ orgId, queryClient }) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.releases,
      });
      if (orgId) {
        await invalidateOrgPlugins(queryClient, orgId);
      }
    }
  );
}

export function useRemovePluginRelease() {
  return usePluginMutation(
    ({ pluginId, version }: { pluginId: string; version: string }) =>
      client.removePluginRelease(pluginId, version),
    async ({ orgId, queryClient }) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.releases,
      });
      if (orgId) {
        await invalidateOrgPlugins(queryClient, orgId);
      }
    }
  );
}

export function useInstallOrgPlugin() {
  return usePluginMutation(
    ({ pluginId, version }: { pluginId: string; version?: string }, orgId) =>
      client.installOrgPlugin(pluginId, version ? { version } : {}, orgId),
    async ({ orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId);
    }
  );
}

export function useEnableOrgPlugin() {
  return usePluginMutation(
    (
      {
        expectedRevision,
        pluginId,
      }: { expectedRevision: number; pluginId: string },
      orgId
    ) => client.enableOrgPlugin(pluginId, expectedRevision, orgId),
    async ({ orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId);
    }
  );
}

export function useDisableOrgPlugin() {
  return usePluginMutation(
    (
      {
        expectedRevision,
        pluginId,
      }: { expectedRevision: number; pluginId: string },
      orgId
    ) => client.disableOrgPlugin(pluginId, expectedRevision, orgId),
    async ({ orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId);
    }
  );
}

export function usePreviewOrgPluginUpdate() {
  return usePluginMutation(
    (
      { pluginId, targetVersion }: { pluginId: string; targetVersion: string },
      orgId
    ) => client.previewOrgPluginUpdate(pluginId, targetVersion, orgId)
  );
}

export function useUpdateOrgPlugin() {
  return usePluginMutation(
    (
      {
        pluginId,
        request,
      }: { pluginId: string; request: UpdateOrgPluginRequest },
      orgId
    ) => client.updateOrgPlugin(pluginId, request, orgId),
    async ({ orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId);
    }
  );
}

export function useUninstallOrgPlugin() {
  return usePluginMutation(
    (
      {
        expectedRevision,
        pluginId,
      }: { expectedRevision: number; pluginId: string },
      orgId
    ) => client.uninstallOrgPlugin(pluginId, expectedRevision, orgId),
    async ({ orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId);
    }
  );
}

export function useDeleteRetainedPluginData() {
  return usePluginMutation(
    (request: DeleteRetainedPluginDataRequest) =>
      client.deleteRetainedPluginData(request),
    async ({ queryClient, variables }) => {
      await invalidateOrgPlugins(queryClient, variables.orgId);
    }
  );
}

export function pluginUiModuleUrl(
  orgId: string,
  pluginId: string,
  revision: number,
  version: string | null
): string {
  return `/v1/plugins/ui/${encodeURIComponent(orgId)}/${encodeURIComponent(pluginId)}/?revision=${revision}&version=${encodeURIComponent(version ?? "")}`;
}

export function isPluginLifecycleBusy(plugin: OrgPluginDetail): boolean {
  return (
    plugin.pendingOperation !== null ||
    plugin.lifecycleState === "enabling" ||
    plugin.lifecycleState === "disabling" ||
    plugin.lifecycleState === "updating"
  );
}

export function nextPluginVersions(plugin: OrgPluginDetail): string[] {
  return plugin.availableVersions.filter(
    (version) => version !== plugin.selectedVersion
  );
}

export function formatPluginTrustLines(
  preview: PluginPackagePreviewResponse
): string[] {
  const { contributions, digest, manifest } = preview;
  return [
    `${manifest.name} ${manifest.version}`,
    manifest.id,
    `Author ${manifest.author}`,
    `License ${manifest.license}`,
    `Digest ${digest}`,
    contributions.hasUi ? "Includes a page" : "No page",
    contributions.hasDatabase ? "Owns a database" : "No database",
    ...(contributions.workerKeys?.length
      ? [`Workers ${contributions.workerKeys.join(", ")}`]
      : []),
    contributions.actionKeys.length > 0
      ? `Actions ${contributions.actionKeys.join(", ")}`
      : "No actions",
    contributions.skillKeys.length > 0
      ? `Skills ${contributions.skillKeys.join(", ")}`
      : "No skills",
  ];
}

export function resolvePluginPageView(input: {
  errorStatus?: number;
  orgRole: string | undefined;
  plugin?: OrgPluginDetail | null;
  queryStatus: "error" | "pending" | "success";
}): PluginPageViewKind {
  if (!canAccessIntegrationsPage(input.orgRole) || input.errorStatus === 403) {
    return "unauthorized";
  }

  if (input.queryStatus === "pending" && !input.plugin) {
    return "loading";
  }

  if (input.errorStatus === 404) {
    return "unavailable";
  }

  const plugin = input.plugin;
  if (!plugin) {
    return "unavailable";
  }

  if (
    plugin.lastLifecycleError === "package_unavailable" ||
    (plugin.lifecycleState === "enabled" && plugin.ui === null)
  ) {
    return "unavailable";
  }

  if (plugin.lifecycleState !== "enabled") {
    return "disabled";
  }

  return "page";
}

export function pluginPageStateMessage(kind: PluginPageViewKind): string {
  if (kind === "unauthorized") {
    return "You can't open this plugin";
  }
  if (kind === "disabled") {
    return "This plugin is off";
  }
  if (kind === "unavailable") {
    return "This plugin isn't available";
  }
  if (kind === "failed") {
    return "This plugin didn't load";
  }
  return "Loading plugin";
}

export function pluginRowActions(plugin: OrgPluginDetail): {
  disable: boolean;
  enable: boolean;
  purge: boolean;
  uninstall: boolean;
  update: boolean;
} {
  return {
    disable: plugin.lifecycleState === "enabled",
    enable: plugin.installed && plugin.lifecycleState === "disabled",
    purge: plugin.lifecycleState === "retained",
    uninstall: plugin.installed && plugin.lifecycleState === "disabled",
    update:
      plugin.installed &&
      plugin.lifecycleState === "disabled" &&
      nextPluginVersions(plugin).length > 0,
  };
}

export function apiErrorStatus(error: unknown): number | undefined {
  if (error instanceof NakamaApiError) {
    return error.status;
  }
  return undefined;
}
