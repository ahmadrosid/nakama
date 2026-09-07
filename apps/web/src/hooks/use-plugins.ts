import { NakamaApiError } from "@nakama/core/api-error";
import type {
  DeleteRetainedPluginDataRequest,
  OrgPluginDetail,
  PluginPackagePreviewResponse,
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

export const NAKAMA_PLUGIN_READY_TYPE = "nakama-plugin-ready";
export const PLUGIN_READY_TIMEOUT_MS = 12_000;

export type PluginPageViewKind =
  | "loading"
  | "unauthorized"
  | "disabled"
  | "unavailable"
  | "failed"
  | "frame";

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
  return usePluginMutation((file: Blob) => client.previewPluginPackage(file));
}

export function useInstallPluginPackage() {
  return usePluginMutation(
    ({ expectedDigest, file }: { expectedDigest?: string; file: Blob }) =>
      client.installPluginPackage(file, { expectedDigest }),
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

export function pluginUiDocumentUrl(
  orgId: string,
  pluginId: string,
  theme: "dark" | "light"
): string {
  const params = new URLSearchParams({ theme });
  return `/v1/plugins/ui/${encodeURIComponent(orgId)}/${encodeURIComponent(pluginId)}/?${params}`;
}

/**
 * Plugin pages post this to window.parent after the app mounts.
 * Iframe `load` is not enough — the host waits PLUGIN_READY_TIMEOUT_MS.
 *
 *   parent.postMessage(
 *     { type: "nakama-plugin-ready", pluginId },
 *     window.location.origin
 *   )
 */
export function isNakamaPluginReadyMessage(
  data: unknown,
  pluginId: string
): boolean {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as { pluginId?: unknown; type?: unknown };
  return (
    record.type === NAKAMA_PLUGIN_READY_TYPE && record.pluginId === pluginId
  );
}

export function isPluginLifecycleBusy(plugin: OrgPluginDetail): boolean {
  return (
    plugin.pendingOperation !== null ||
    plugin.lifecycleState === "enabling" ||
    plugin.lifecycleState === "disabling" ||
    plugin.lifecycleState === "updating"
  );
}

export function pluginHasRetainedData(plugin: OrgPluginDetail): boolean {
  return (
    plugin.lifecycleState === "retained" || plugin.databaseGeneration !== null
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
  iframeReady: boolean;
  loadTimedOut: boolean;
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

  if (input.loadTimedOut && !input.iframeReady) {
    return "failed";
  }

  return "frame";
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

export function pluginRowIdentity(plugin: OrgPluginDetail): string {
  return `${plugin.name} ${plugin.pluginId}`;
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
