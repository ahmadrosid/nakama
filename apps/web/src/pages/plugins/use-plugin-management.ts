import type {
  OrgPluginDetail,
  PluginContributionChangePreview,
  PluginPackagePreviewResponse,
  PluginPackageRequest,
  PluginReleaseSummary,
} from "@nakama/core/contract";
import { useRef, useState } from "react";
import {
  useDeleteRetainedPluginData,
  useDisableOrgPlugin,
  useEnableOrgPlugin,
  useInstallOfficialPlugin,
  useInstallOrgPlugin,
  useInstallPluginPackage,
  useOfficialPlugins,
  useOrgPlugins,
  usePluginReleases,
  usePluginUpdates,
  usePluginUsage,
  usePreviewOrgPluginUpdate,
  usePreviewPluginPackage,
  useReinstallOfficialPlugin,
  useRemovePluginRelease,
  useUninstallOrgPlugin,
  useUnplugPlugin,
  useUpdateOrgPlugin,
} from "@/hooks/use-plugins";
import { client, formatError } from "@/lib/client";

export const PLUGIN_DESCRIPTIONS = new Map([
  ["supermemory", "Save and search agent memories."],
  ["workflows", "Automate tasks with your agents."],
]);

export type PluginDialog =
  | { type: "package-entry" }
  | {
      type: "official-install";
      pluginId: string;
      name: string;
      description: string;
    }
  | {
      /** Set when approving a newer version of a plugin this org already runs. */
      plugin?: OrgPluginDetail;
      source: PluginPackageRequest;
      preview: PluginPackagePreviewResponse;
      type: "package";
    }
  | { plugin: OrgPluginDetail; type: "install" }
  | { plugin: OrgPluginDetail; type: "enable" }
  | { plugin: OrgPluginDetail; type: "disable" }
  | {
      plugin: OrgPluginDetail;
      preview: PluginContributionChangePreview;
      targetVersion: string;
      type: "update";
    }
  | { plugin: OrgPluginDetail; type: "uninstall" }
  | { plugin: OrgPluginDetail; type: "purge" }
  | { pluginId: string; type: "remove-release"; version: string }
  | { pluginId: string; type: "remove-plugin"; versions: string[] }
  | { pluginId: string; type: "force-delete"; versions: string[] };

export function usePluginCatalog(canInstallPackages: boolean) {
  const { data: plugins = [], isLoading, error } = useOrgPlugins();
  const releasesQuery = usePluginReleases(canInstallPackages);
  const officialQuery = useOfficialPlugins();
  const official = officialQuery.data?.plugins ?? [];
  const updates = usePluginUpdates(canInstallPackages).data?.updates ?? [];

  const releases = canInstallPackages
    ? (releasesQuery.data?.releases ?? [])
    : [];

  const pluginIds = [
    ...new Set([
      ...plugins.map((plugin) => plugin.pluginId),
      ...official.map((plugin) => plugin.id),
      ...releases.map((release) => release.pluginId),
    ]),
  ];

  return {
    catalogLoading: officialQuery.isLoading || releasesQuery.isLoading,
    error:
      error ??
      officialQuery.error ??
      (canInstallPackages ? releasesQuery.error : null),
    isLoading,
    official,
    pluginIds,
    plugins,
    releases,
    updates,
  };
}

export function usePluginManagement(
  canInstallPackages: boolean,
  orgId: string
) {
  const installOfficial = useInstallOfficialPlugin();
  const previewPackage = usePreviewPluginPackage();
  const installPackage = useInstallPluginPackage();
  const removeRelease = useRemovePluginRelease();
  const installOrg = useInstallOrgPlugin();
  const enableOrg = useEnableOrgPlugin();
  const disableOrg = useDisableOrgPlugin();
  const previewUpdate = usePreviewOrgPluginUpdate();
  const updateOrg = useUpdateOrgPlugin();
  const uninstallOrg = useUninstallOrgPlugin();
  const purgeData = useDeleteRetainedPluginData();
  const unplug = useUnplugPlugin();
  const reinstallOfficial = useReinstallOfficialPlugin();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<PluginDialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [accessDialog, setAccessDialog] = useState<{
    orgId: string;
    plugin: OrgPluginDetail;
  } | null>(null);

  const busy = [
    previewPackage,
    installPackage,
    removeRelease,
    installOrg,
    enableOrg,
    disableOrg,
    previewUpdate,
    updateOrg,
    uninstallOrg,
    purgeData,
    unplug,
    reinstallOfficial,
    installOfficial,
  ].some((mutation) => mutation.isPending);

  function rememberFocus(target: EventTarget | null) {
    if (target instanceof HTMLElement) {
      restoreFocusRef.current = target;
    }
  }

  function closeDialog() {
    setDialog(null);
    setAccessDialog(null);
    setActionError(null);
    queueMicrotask(() => restoreFocusRef.current?.focus());
  }

  async function previewNpmPackage(
    source: PluginPackageRequest,
    plugin?: OrgPluginDetail
  ) {
    if (!canInstallPackages) {
      return;
    }

    setActionError(null);

    try {
      const preview = await previewPackage.mutateAsync(source);
      setDialog({ plugin, preview, source, type: "package" });
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  async function handleUpdate(plugin: OrgPluginDetail, targetVersion: string) {
    setActionError(null);

    try {
      const preview = await previewUpdate.mutateAsync({
        pluginId: plugin.pluginId,
        targetVersion,
      });

      setDialog({ plugin, preview, targetVersion, type: "update" });
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  async function confirmDialog() {
    if (!dialog || dialog.type === "package-entry") {
      return;
    }

    setActionError(null);

    try {
      if (dialog.type === "official-install") {
        await installOfficial.mutateAsync(dialog.pluginId);
      } else if (dialog.type === "package") {
        await installPackage.mutateAsync({
          expectedDigest: dialog.preview.digest,
          expectedIntegrity: dialog.preview.integrity,
          ...dialog.source,
        });

        if (dialog.plugin) {
          await handleUpdate(dialog.plugin, dialog.source.version);

          return;
        }
      } else if (dialog.type === "install") {
        await installOrg.mutateAsync({ pluginId: dialog.plugin.pluginId });
      } else if (dialog.type === "enable") {
        await enableOrg.mutateAsync({
          expectedRevision: dialog.plugin.revision,
          pluginId: dialog.plugin.pluginId,
        });
      } else if (dialog.type === "disable") {
        await disableOrg.mutateAsync({
          expectedRevision: dialog.plugin.revision,
          pluginId: dialog.plugin.pluginId,
        });
      } else if (dialog.type === "update") {
        let plugin = dialog.plugin;
        const wasEnabled = plugin.lifecycleState === "enabled";

        if (wasEnabled) {
          // The server only swaps releases on a disabled plugin.
          plugin = await disableOrg.mutateAsync({
            expectedRevision: plugin.revision,
            pluginId: plugin.pluginId,
          });
          setDialog({ ...dialog, plugin });
        }

        plugin = await updateOrg.mutateAsync({
          pluginId: plugin.pluginId,
          request: {
            expectedRevision: plugin.revision,
            targetVersion: dialog.targetVersion,
          },
        });

        if (wasEnabled) {
          await enableOrg.mutateAsync({
            expectedRevision: plugin.revision,
            pluginId: plugin.pluginId,
          });
        }
      } else if (dialog.type === "uninstall") {
        let plugin = dialog.plugin;

        if (plugin.lifecycleState === "enabled") {
          plugin = await disableOrg.mutateAsync({
            expectedRevision: plugin.revision,
            pluginId: plugin.pluginId,
          });
          setDialog({ plugin, type: "uninstall" });
        }

        await uninstallOrg.mutateAsync({
          expectedRevision: plugin.revision,
          pluginId: plugin.pluginId,
        });
      } else if (dialog.type === "purge") {
        await purgeData.mutateAsync({
          confirm: true,
          expectedRevision: dialog.plugin.revision,
          orgId,
          pluginId: dialog.plugin.pluginId,
        });
      } else if (dialog.type === "force-delete") {
        const usage = await client.getPluginUsage(dialog.pluginId);

        await Promise.all(
          usage.orgs.map((org) =>
            unplug.mutateAsync({ org, pluginId: dialog.pluginId })
          )
        );

        await Promise.all(
          dialog.versions.map((version) =>
            removeRelease.mutateAsync({ pluginId: dialog.pluginId, version })
          )
        );
      } else if (dialog.type === "remove-plugin") {
        await Promise.all(
          dialog.versions.map((version) =>
            removeRelease.mutateAsync({ pluginId: dialog.pluginId, version })
          )
        );
      } else {
        await removeRelease.mutateAsync({
          pluginId: dialog.pluginId,
          version: dialog.version,
        });
      }

      closeDialog();
    } catch (err) {
      setActionError(formatError(err));
    }
  }

  return {
    accessDialog,
    actionError,
    busy,
    closeDialog,
    confirmDialog,
    dialog,
    handleUpdate,
    previewNpmPackage,
    reinstallOfficial,
    rememberFocus,
    setAccessDialog,
    setActionError,
    setDialog,
  };
}

/** Built-in (official catalog), Super Nakama drafts (local releases), then the rest. */
export function groupPluginIds(
  pluginIds: string[],
  official: Array<{ id: string }>,
  releases: PluginReleaseSummary[]
) {
  const builtIn = new Set(official.map((item) => item.id));

  const createdBySuperNakama = new Set(
    releases.flatMap((item) =>
      item.source === "local" || item.source === "agent" ? [item.pluginId] : []
    )
  );

  const groups = [
    {
      ids: pluginIds.filter((id) => builtIn.has(id)),
      title: "Built-in",
    },
    {
      ids: pluginIds.filter(
        (id) => !builtIn.has(id) && createdBySuperNakama.has(id)
      ),
      title: "Created by you",
    },
    {
      ids: pluginIds.filter(
        (id) => !(builtIn.has(id) || createdBySuperNakama.has(id))
      ),
      title: "From other sources",
    },
  ];

  return groups.filter((group) => group.ids.length > 0);
}

export function pluginMatchesQuery(
  pluginId: string,
  needle: string,
  catalog: {
    official: Array<{ description: string; id: string; name: string }>;
    plugins: OrgPluginDetail[];
    releases: PluginReleaseSummary[];
  }
) {
  if (!needle) {
    return true;
  }

  const plugin = catalog.plugins.find((item) => item.pluginId === pluginId);
  const official = catalog.official.find((item) => item.id === pluginId);
  const release = catalog.releases.find((item) => item.pluginId === pluginId);

  return [
    pluginId,
    plugin?.name,
    plugin?.description,
    official?.name,
    official?.description,
    release?.manifest.name,
    release?.manifest.description,
    PLUGIN_DESCRIPTIONS.get(pluginId),
  ].some((text) => text?.toLowerCase().includes(needle));
}

/** Organizations that still hold the plugin a delete dialog would remove. */
export function useRemovalBlockers(dialog: PluginDialog | null) {
  const pluginId = dialog?.type === "remove-plugin" ? dialog.pluginId : null;
  const usage = usePluginUsage(pluginId);
  const orgs = usage.data?.orgs ?? [];

  return {
    blocked: Boolean(pluginId) && (usage.isPending || orgs.length > 0),
    inUse: pluginId && orgs.length > 0 ? { orgs, pluginId } : null,
  };
}

export function dialogTitle(dialog: PluginDialog | null): string {
  if (!dialog) {
    return "Plugin";
  }

  if (dialog.type === "package-entry") {
    return "Install from npm package";
  }

  if (dialog.type === "official-install") {
    return `Add ${dialog.name}?`;
  }

  if (dialog.type === "package") {
    return "Install this plugin?";
  }

  if (dialog.type === "install") {
    return "Add to your organization?";
  }

  if (dialog.type === "enable") {
    return "Turn on this plugin?";
  }

  if (dialog.type === "disable") {
    return "Turn off this plugin?";
  }

  if (dialog.type === "update") {
    return "Update this plugin?";
  }

  if (dialog.type === "uninstall") {
    return "Remove this plugin?";
  }

  if (dialog.type === "purge") {
    return "Delete saved data?";
  }

  if (dialog.type === "force-delete") {
    return "Force delete this plugin?";
  }

  if (dialog.type === "remove-plugin") {
    return "Delete this plugin?";
  }

  return "Remove this version?";
}

export function confirmLabel(dialog: PluginDialog | null): string {
  if (!dialog) {
    return "Confirm";
  }

  if (
    dialog.type === "package" ||
    dialog.type === "install" ||
    dialog.type === "official-install"
  ) {
    return dialog.type === "package" ? "Install" : "Add";
  }

  if (dialog.type === "enable") {
    return "Turn on";
  }

  if (dialog.type === "disable") {
    return "Turn off";
  }

  if (dialog.type === "update") {
    return "Update";
  }

  if (dialog.type === "uninstall") {
    return "Remove";
  }

  if (dialog.type === "purge") {
    return "Delete saved data";
  }

  if (dialog.type === "force-delete") {
    return "Force delete";
  }

  if (dialog.type === "remove-plugin") {
    return "Delete";
  }

  return "Remove";
}
