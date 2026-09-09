import { NakamaApiError } from "@nakama/core/api-error";
import type {
  DeleteRetainedPluginDataRequest,
  InstallPluginPackageRequest,
  OrgPluginDetail,
  PluginPackagePreviewResponse,
  PluginPackageRequest,
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
  orgId: string,
  pluginId?: string
) {
  const tasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all(orgId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.tools.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
  ];
  if (pluginId) {
    tasks.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.detail(orgId, pluginId),
      })
    );
  }
  return Promise.all(tasks);
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
    async ({ data, orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId, data.pluginId);
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
    async ({ data, orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId, data.pluginId);
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
    async ({ data, orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId, data.pluginId);
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
    async ({ data, orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId, data.pluginId);
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
    async ({ data, orgId, queryClient }) => {
      await invalidateOrgPlugins(queryClient, orgId, data.pluginId);
    }
  );
}

export function useDeleteRetainedPluginData() {
  return usePluginMutation(
    (request: DeleteRetainedPluginDataRequest) =>
      client.deleteRetainedPluginData(request),
    async ({ queryClient, variables }) => {
      await invalidateOrgPlugins(
        queryClient,
        variables.orgId,
        variables.pluginId
      );
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

  if (input.queryStatus === "error" && !input.plugin) {
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

  if (plugin.ui === null) {
    return "unavailable";
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
