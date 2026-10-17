import type {
  LocalPluginPreviewResponse,
  OrgPluginDetail,
  PluginContributionChangePreview,
  PluginPackagePreviewResponse,
  PluginPackageRequest,
  PluginReleaseSummary,
  PluginUsageOrg,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Checkbox } from "@nakama/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Input } from "@nakama/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  MoreHorizontalIcon,
  Search01Icon,
  Tick02Icon,
} from "hugeicons-react";
import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useAuth } from "@/context/use-auth";
import {
  formatPluginTrustLines,
  isNewerPluginVersion,
  isPluginLifecycleBusy,
  nextPluginVersions,
  pluginAgentAccessState,
  pluginRowActions,
  useDeleteRetainedPluginData,
  useDisableOrgPlugin,
  useEnableOrgPlugin,
  useInstallLocalPlugin,
  useInstallOfficialPlugin,
  useInstallOrgPlugin,
  useInstallPluginPackage,
  useOfficialPlugins,
  useOrgPlugins,
  usePluginAgentAccess,
  usePluginReleases,
  usePluginUpdates,
  usePluginUsage,
  usePreviewOrgPluginUpdate,
  usePreviewPluginPackage,
  useReinstallOfficialPlugin,
  useRemovePluginRelease,
  useSavePluginAgentAccess,
  useUninstallOrgPlugin,
  useUnplugPlugin,
  useUpdateOrgPlugin,
} from "@/hooks/use-plugins";
import { usePinnedPlugins } from "@/hooks/use-sidebar-collapsed";
import { client, formatError } from "@/lib/client";
import { formatBytes } from "@/lib/knowledge-base-files";
import {
  canAccessSystemPage,
  canManagePluginReleases,
  pluginIcon,
  pluginPagePath,
} from "@/lib/navigation";

const PLUGIN_DESCRIPTIONS = new Map([
  ["supermemory", "Save and search agent memories."],
  ["workflows", "Automate tasks with your agents."],
]);

type PluginDialog =
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

function usePluginCatalog(canInstallPackages: boolean) {
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

function usePluginManagement(canInstallPackages: boolean, orgId: string) {
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

        for (const org of usage.orgs) {
          await unplug.mutateAsync({ org, pluginId: dialog.pluginId });
        }

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
function groupPluginIds(
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

function pluginMatchesQuery(
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

export function PluginsPage() {
  const { pluginId: selectedPluginId } = useParams<{ pluginId: string }>();
  const { user, activeOrg } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canManage = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const canInstallPackages = canManagePluginReleases(isPlatformAdmin);
  const orgId = activeOrg?.id ?? "";

  const {
    plugins,
    official,
    releases,
    pluginIds,
    updates,
    isLoading,
    catalogLoading,
    error: queryError,
  } = usePluginCatalog(canInstallPackages);

  const {
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
  } = usePluginManagement(canInstallPackages, orgId);

  const agentAccess = usePluginAgentAccess();
  const accessData = isPlatformAdmin ? agentAccess.data : undefined;
  const [query, setQuery] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);

  if (isLoading && plugins.length === 0) {
    return <PluginEmptyState detail={Boolean(selectedPluginId)} loading />;
  }

  const errorMessage =
    actionError ?? (queryError ? formatError(queryError) : null);

  const needle = query.trim().toLowerCase();
  const canInstallHere = canInstallPackages && Boolean(orgId);

  const visiblePluginIds = selectedPluginId
    ? pluginIds.filter((id) => id === selectedPluginId)
    : pluginIds.filter((id) =>
        pluginMatchesQuery(id, needle, { official, plugins, releases })
      );

  const renderRow = (pluginId: string) => {
    const plugin = plugins.find((item) => item.pluginId === pluginId);
    const catalog = official.find((item) => item.id === pluginId);

    const pluginReleases = releases.filter(
      (item) => item.pluginId === pluginId
    );

    const updatable =
      plugin?.installed &&
      ["enabled", "disabled"].includes(plugin.lifecycleState);

    const registryUpdate = updatable
      ? updates.find(
          (item) =>
            item.pluginId === pluginId &&
            isNewerPluginVersion(item.version, plugin)
        )
      : undefined;

    const updateVersion = updatable
      ? (nextPluginVersions(plugin)[0] ?? registryUpdate?.version)
      : undefined;

    return (
      <PluginRow
        accessCount={accessData?.counts[pluginId]}
        busy={busy || Boolean(plugin && isPluginLifecycleBusy(plugin))}
        canManage={canManage}
        canManageAgentAccess={isPlatformAdmin}
        catalogDescription={catalog?.description}
        detail={Boolean(selectedPluginId)}
        icon={plugin?.icon ?? catalog?.icon ?? pluginReleases[0]?.manifest.icon}
        key={pluginId}
        name={
          plugin?.name ??
          catalog?.name ??
          pluginReleases[0]?.manifest.name ??
          pluginId
        }
        official={Boolean(catalog)}
        onAction={(type, target) => {
          rememberFocus(target);
          setActionError(null);

          if (type === "install" && catalog) {
            setDialog({
              description: catalog.description,
              name: catalog.name,
              pluginId,
              type: "official-install",
            });

            return;
          }

          if (type === "remove-plugin" || type === "force-delete") {
            setDialog({
              pluginId,
              type,
              versions: pluginReleases.map((item) => item.version),
            });

            return;
          }

          if (!plugin) {
            return;
          }

          if (type === "access") {
            setAccessDialog({ orgId, plugin });

            return;
          }

          if (type === "reinstall") {
            void reinstallOfficial
              .mutateAsync({
                expectedRevision: plugin.revision,
                pluginId,
              })
              .catch((err) => setActionError(formatError(err)));

            return;
          }

          if (type === "update") {
            const version = nextPluginVersions(plugin)[0];

            if (version) {
              void handleUpdate(plugin, version);
            } else if (registryUpdate) {
              // Nobody approved this version yet: review it, then update.
              void previewNpmPackage(
                {
                  packageName: registryUpdate.packageName,
                  version: registryUpdate.version,
                },
                plugin
              );
            }

            return;
          }

          setDialog({ plugin, type });
        }}
        onRemove={(release, event) => {
          rememberFocus(event.currentTarget);
          setDialog({
            pluginId,
            type: "remove-release",
            version: release.version,
          });
        }}
        plugin={plugin}
        pluginId={pluginId}
        releases={pluginReleases}
        updateVersion={canManage ? updateVersion : undefined}
      />
    );
  };

  const groups = selectedPluginId
    ? [{ ids: visiblePluginIds, title: null }]
    : groupPluginIds(visiblePluginIds, official, releases);

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-6">
      <PluginPageHeader
        busy={busy}
        canInstall={canInstallHere}
        detail={Boolean(selectedPluginId)}
        error={dialog ? null : errorMessage}
        onInstall={(target) => {
          rememberFocus(target);
          setActionError(null);
          setDialog({ type: "package-entry" });
        }}
        onInstallFromFolder={() => setFolderOpen(true)}
        onQueryChange={setQuery}
        query={query}
      />
      {canInstallHere ? (
        <LocalPluginInstaller
          key={orgId}
          onOpenChange={setFolderOpen}
          open={folderOpen}
          orgId={orgId}
        />
      ) : null}

      {visiblePluginIds.length === 0 ? (
        <PluginEmptyState
          detail={Boolean(selectedPluginId)}
          filtered={pluginIds.length > 0}
          loading={catalogLoading}
        />
      ) : (
        groups.map((group) => (
          <section className="space-y-2.5" key={group.title ?? "all"}>
            {group.title ? (
              <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                {group.title}
              </h2>
            ) : null}
            <ul
              className={
                selectedPluginId
                  ? "min-w-0"
                  : "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
              }
            >
              {group.ids.map(renderRow)}
            </ul>
          </section>
        ))
      )}

      {isPlatformAdmin && accessDialog?.orgId === orgId ? (
        <PluginAgentAccessDialog
          key={`${orgId}:${accessDialog.plugin.pluginId}`}
          onClose={closeDialog}
          plugin={accessDialog.plugin}
        />
      ) : null}
      <PluginConfirmDialog
        busy={busy}
        dialog={dialog}
        error={actionError}
        onClose={closeDialog}
        onConfirm={() => void confirmDialog()}
        onPreview={(source) => void previewNpmPackage(source)}
      />
    </div>
  );
}

function PluginEmptyState({
  detail,
  filtered = false,
  loading,
}: {
  detail: boolean;
  filtered?: boolean;
  loading: boolean;
}) {
  let message = detail ? "Plugin not found." : "No plugins available.";

  if (filtered && !detail) {
    message = "No plugins match.";
  }

  if (loading) {
    message = "Loading plugins…";
  }

  return (
    <p className="py-10 text-center text-muted-foreground text-sm">{message}</p>
  );
}

function PluginPageHeader({
  busy,
  canInstall,
  detail,
  error,
  onInstall,
  onInstallFromFolder,
  onQueryChange,
  query,
}: {
  busy: boolean;
  canInstall: boolean;
  detail: boolean;
  error: string | null;
  onInstall(target: HTMLElement | null): void;
  onInstallFromFolder(): void;
  onQueryChange(query: string): void;
  query: string;
}) {
  const installRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3 empty:hidden">
      {detail ? (
        <Link
          className="mr-auto text-muted-foreground text-sm hover:text-foreground"
          to="/customize/plugins"
        >
          ← Back to plugins
        </Link>
      ) : (
        <div className="relative min-w-60 flex-1">
          <Search01Icon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search plugins"
            className="pl-9"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search plugins"
            type="search"
            value={query}
          />
        </div>
      )}
      {canInstall && !detail ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button disabled={busy} ref={installRef} />}
          >
            <Add01Icon aria-hidden="true" className="size-4" />
            Install plugin
            <ArrowDown01Icon aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onInstallFromFolder}>
              Made by Super Nakama
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onInstall(installRef.current)}>
              From npm package
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {error ? (
        <p
          className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PluginPackageForm({
  busy,
  onClose,
  onPreview,
}: {
  busy: boolean;
  onClose(): void;
  onPreview(source: PluginPackageRequest): void;
}) {
  const [packageName, setPackageName] = useState("");
  const [packageVersion, setPackageVersion] = useState("");

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onPreview({
          packageName: packageName.trim(),
          version: packageVersion.trim(),
        });
      }}
    >
      <label className="grid gap-2 text-sm">
        npm package
        <Input
          aria-label="npm package name"
          disabled={busy}
          onChange={(event) => setPackageName(event.target.value)}
          placeholder="@team/nakama-notes"
          required
          value={packageName}
        />
      </label>
      <label className="grid gap-2 text-sm">
        Version
        <Input
          aria-label="Exact package version"
          disabled={busy}
          onChange={(event) => setPackageVersion(event.target.value)}
          placeholder="1.0.0"
          required
          value={packageVersion}
        />
      </label>
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={busy || !packageName.trim() || !packageVersion.trim()}
          size="sm"
          type="submit"
        >
          {busy ? <Spinner className="size-4" /> : null}
          Preview package
        </Button>
      </DialogFooter>
    </form>
  );
}

// Code that runs first, so the reviewer reads it first. The last group catches the rest.
const LOCAL_REVIEW_GROUPS = [
  ["Runs on the server", /^(actions|workers)\//],
  ["Runs in the browser", /^ui\//],
  ["Database migrations", /^migrations\//],
  ["Source", /^src\//],
  ["Config and other files", /./],
] as const;

/** Display only: the install still uses the reviewed bytes and digest. */
function formatJsonForReview(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function LocalPluginReviewFiles({
  disabled,
  file,
  files,
  onClose,
  onRead,
  reviewed,
}: {
  disabled: boolean;
  file: { path: string; content: string } | null;
  files: LocalPluginPreviewResponse["files"];
  onClose(): void;
  onRead(path: string): Promise<void>;
  reviewed: Set<string>;
}) {
  return (
    <>
      {LOCAL_REVIEW_GROUPS.map(([label, pattern], index) => {
        const groupFiles = files.filter(
          (item) =>
            LOCAL_REVIEW_GROUPS.findIndex(([, match]) =>
              match.test(item.path)
            ) === index
        );

        if (groupFiles.length === 0) {
          return null;
        }

        const runs = index < 3;

        return (
          <section className="min-w-0" key={String(pattern)}>
            <h3
              className={cn(
                "mb-1.5 font-semibold text-xs uppercase tracking-wide",
                runs ? "text-primary" : "text-muted-foreground"
              )}
            >
              {label}
            </h3>
            <ul
              className={cn(
                "divide-y overflow-hidden rounded-lg border",
                runs && "border-primary/40"
              )}
            >
              {groupFiles.map((item) => {
                const open = file?.path === item.path;
                const read = reviewed.has(item.path);

                return (
                  <li key={item.path}>
                    <button
                      aria-expanded={open}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm disabled:opacity-60",
                        open && "bg-muted/60"
                      )}
                      disabled={disabled}
                      onClick={() => (open ? onClose() : onRead(item.path))}
                      type="button"
                    >
                      {open ? (
                        <ArrowDown01Icon aria-hidden className="size-4" />
                      ) : (
                        <ArrowRight01Icon aria-hidden className="size-4" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        {item.path}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatBytes(item.size)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-medium text-xs",
                          read
                            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                            : "border text-muted-foreground"
                        )}
                      >
                        {read ? "Read" : "Not read"}
                      </span>
                    </button>
                    {open ? (
                      <pre
                        aria-label={file.path}
                        className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t bg-background p-3 font-mono text-xs leading-relaxed"
                      >
                        {file.content}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function LocalPluginDraftPicker({
  disabled,
  draftId,
  error,
  open,
  orgId,
  profileId,
  onDraftChange,
  onProfileChange,
  onPreview,
}: {
  disabled: boolean;
  draftId: string;
  error: string | null;
  open: boolean;
  orgId: string;
  profileId: string;
  onDraftChange(value: string): void;
  onProfileChange(value: string): void;
  onPreview(): Promise<void>;
}) {
  const profiles = useQuery({
    enabled: open,
    queryFn: () => client.listProfiles(orgId),
    queryKey: ["plugin-draft-profiles", orgId],
  });

  return (
    <>
      <Select
        disabled={disabled}
        onValueChange={(value) => {
          onProfileChange(value ?? "");
        }}
        value={profileId}
      >
        <SelectTrigger aria-label="Super Nakama">
          <SelectValue placeholder="Super Nakama" />
        </SelectTrigger>
        <SelectContent>
          {(profiles.data?.profiles ?? [])
            .filter((profile) => profile.isSuper)
            .map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="Draft ID"
        disabled={disabled}
        onChange={(event) => {
          onDraftChange(event.target.value);
        }}
        placeholder="Draft ID"
        value={draftId}
      />
      {profiles.error ? (
        <p role="alert">{formatError(profiles.error)}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <Button
        disabled={!(profileId && draftId) || disabled}
        onClick={onPreview}
      >
        Preview draft
      </Button>
    </>
  );
}

/** Reads a draft file in chunks. Returns null when a newer request took over. */
async function readLocalPluginText(
  preview: LocalPluginPreviewResponse,
  path: string,
  isCurrent: () => boolean
): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let offset: number | null = 0;

  while (offset !== null && isCurrent()) {
    const value = await client.readLocalPluginFile({
      ...preview.draft,
      expectedDigest: preview.digest,
      offset,
      path,
    });

    chunks.push(
      Uint8Array.from(atob(value.content), (character) =>
        character.charCodeAt(0)
      )
    );
    offset = value.nextOffset;
  }

  if (!isCurrent()) {
    return null;
  }

  const data = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.length, 0)
  );

  let position = 0;

  for (const chunk of chunks) {
    data.set(chunk, position);
    position += chunk.length;
  }

  const text = new TextDecoder().decode(data);

  return path.endsWith(".json") ? formatJsonForReview(text) : text;
}

function LocalPluginInstallButton({
  draft,
  onClick,
}: {
  draft: boolean;
  onClick(): void;
}) {
  return (
    <Button
      onClick={onClick}
      size={draft ? "sm" : "default"}
      variant={draft ? "default" : "outline"}
    >
      {draft ? "Review and install" : "Install from folder"}
    </Button>
  );
}

export function LocalPluginInstaller({
  draft,
  orgId,
  open: openProp,
  onOpenChange,
}: {
  draft?: { draftId: string; profileId: string };
  orgId: string;
  /** Set both to open the dialog from another control; no trigger button renders. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [profileId, setProfileId] = useState(draft?.profileId ?? "");
  const [draftId, setDraftId] = useState(draft?.draftId ?? "");

  const [preview, setPreview] = useState<LocalPluginPreviewResponse | null>(
    null
  );

  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null
  );

  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const install = useInstallLocalPlugin();
  const busy = pending || install.isPending;

  function reset() {
    generation.current += 1;
    setPreview(null);
    setFile(null);
    setReviewed(new Set());
    setPending(false);
    setError(null);
  }

  async function loadPreview() {
    reset();
    const turn = generation.current;
    setPending(true);

    try {
      const value = await client.previewLocalPlugin({
        draftId,
        orgId,
        profileId,
      });

      if (turn === generation.current) {
        setPreview(value);
      }
    } catch (failure) {
      if (turn === generation.current) {
        setError(formatError(failure));
      }
    } finally {
      setPending((previous) =>
        turn === generation.current ? false : previous
      );
    }
  }

  async function readFile(path: string) {
    if (!preview) {
      return;
    }

    const turn = ++generation.current;
    setFile(null);
    setPending(true);
    setError(null);

    try {
      const content = await readLocalPluginText(
        preview,
        path,
        () => turn === generation.current
      );

      if (content !== null) {
        setFile({ content, path });
        setReviewed((previous) => new Set([...previous, path]));
      }
    } catch (failure) {
      if (turn === generation.current) {
        setError(formatError(failure));
        setPreview(null);
        setReviewed(new Set());
      }
    } finally {
      setPending((previous) =>
        turn === generation.current ? false : previous
      );
    }
  }

  async function confirm() {
    if (!preview || pending || install.isPending) {
      return;
    }

    setError(null);

    try {
      await install.mutateAsync({
        ...preview.draft,
        expectedDigest: preview.digest,
        expectedRevision: preview.expectedRevision,
      });
      setOpen(false);
      reset();
    } catch (failure) {
      setError(formatError(failure));
      setPreview(null);
      setReviewed(new Set());
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        reset();
      }}
      open={open}
    >
      {onOpenChange ? null : (
        <LocalPluginInstallButton
          draft={Boolean(draft)}
          onClick={() => {
            reset();
            setOpen(true);

            if (draft) {
              void loadPreview();
            }
          }}
        />
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Install a plugin made by Super Nakama</DialogTitle>
        </DialogHeader>
        {draft ? (
          error ? (
            <p role="alert">{error}</p>
          ) : null
        ) : (
          <LocalPluginDraftPicker
            disabled={busy}
            draftId={draftId}
            error={error}
            onDraftChange={(value) => {
              reset();
              setDraftId(value);
            }}
            onPreview={loadPreview}
            onProfileChange={(value) => {
              reset();
              setProfileId(value);
            }}
            open={open}
            orgId={orgId}
            profileId={profileId}
          />
        )}
        {preview ? (
          <>
            <div>
              <p className="font-medium">
                {preview.manifest.name}{" "}
                <span className="font-normal text-muted-foreground">
                  {preview.manifest.version}
                </span>
              </p>
              <p className="text-muted-foreground text-sm">
                Install only plugins you trust. A plugin can see and change all
                data on this server.
              </p>
            </div>
            <LocalPluginReviewFiles
              disabled={busy}
              file={file}
              files={preview.files}
              onClose={() => setFile(null)}
              onRead={readFile}
              reviewed={reviewed}
            />
            <DialogFooter className="sticky -bottom-4 z-10 items-center gap-3 bg-muted sm:justify-between">
              <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                sha256 {preview.digest}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-muted-foreground text-sm tabular-nums">
                  {reviewed.size} of {preview.files.length} read
                </span>
                <Button disabled={busy} onClick={confirm}>
                  {install.isPending ? "Installing…" : "Confirm installation"}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PluginReleasesList({
  busy,
  plugins,
  releases,
  onRemove,
}: {
  busy: boolean;
  plugins: OrgPluginDetail[];
  releases: PluginReleaseSummary[];
  onRemove(release: PluginReleaseSummary, event: MouseEvent<HTMLElement>): void;
}) {
  if (releases.length === 0) {
    return null;
  }

  return (
    <ul className="divide-y divide-border">
      {releases.map((release) => {
        const inUse = plugins.some(
          (plugin) =>
            plugin.pluginId === release.pluginId &&
            plugin.selectedVersion === release.version &&
            plugin.installed
        );

        return (
          <li
            className="flex flex-wrap items-center justify-between gap-3 py-3"
            key={`${release.pluginId}@${release.version}`}
          >
            <div className="min-w-0">
              <p className="break-all font-mono text-xs">{release.version}</p>
              {release.source === "local" || release.source === "agent" ? (
                <span className="text-xs">
                  {release.source === "agent"
                    ? "Made by Super Nakama"
                    : "From a folder"}
                </span>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {inUse ? "In use" : "Available"}
              </p>
            </div>
            <Button
              disabled={busy || inUse}
              onClick={(event) => {
                onRemove(release, event);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Remove version
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

interface PluginRowProps {
  accessCount?: number;
  busy: boolean;
  canManage: boolean;
  canManageAgentAccess: boolean;
  catalogDescription?: string;
  detail?: boolean;
  icon?: string;
  name: string;
  official: boolean;
  onAction(
    type:
      | Exclude<
          PluginDialog["type"],
          "package" | "package-entry" | "remove-release" | "official-install"
        >
      | "reinstall"
      | "access"
      | "remove-plugin"
      | "force-delete",
    target: HTMLElement | null
  ): void;
  onRemove(release: PluginReleaseSummary, event: MouseEvent<HTMLElement>): void;
  plugin?: OrgPluginDetail;
  pluginId: string;
  releases: PluginReleaseSummary[];
  /** A newer version this org can move to, approved or still in the registry. */
  updateVersion?: string;
}

function PluginRow({
  catalogDescription,
  detail = false,
  plugin,
  icon,
  pluginId,
  name,
  official,
  releases,
  busy,
  canManage,
  canManageAgentAccess,
  accessCount,
  onAction,
  onRemove,
  updateVersion,
}: PluginRowProps) {
  return (
    <li className={detail ? "min-w-0" : "min-w-0 px-4 py-3.5"}>
      <div className="flex flex-wrap items-center gap-3">
        <PluginIdentity
          catalogDescription={catalogDescription}
          detail={detail}
          icon={icon}
          name={name}
          official={official}
          plugin={plugin}
          pluginId={pluginId}
          releases={releases}
          updateVersion={updateVersion}
        />
        <PluginRowControls
          busy={busy}
          canManage={canManage}
          canManageAgentAccess={canManageAgentAccess}
          detail={detail}
          name={name}
          official={official}
          onAction={onAction}
          plugin={plugin}
          pluginId={pluginId}
          releases={releases}
          updateVersion={updateVersion}
        />
      </div>
      {plugin?.lastLifecycleError ? (
        <p className="mt-2 break-words text-destructive text-xs" role="alert">
          {plugin.lastLifecycleError}
        </p>
      ) : null}
      {detail ? (
        <PluginRowDetails
          accessCount={accessCount}
          busy={busy}
          onRemove={onRemove}
          plugin={plugin}
          pluginId={pluginId}
          releases={releases}
        />
      ) : null}
    </li>
  );
}

function PluginIdentity({
  catalogDescription,
  detail,
  icon,
  name,
  official,
  plugin,
  pluginId,
  releases,
  updateVersion,
}: Pick<
  PluginRowProps,
  | "catalogDescription"
  | "detail"
  | "icon"
  | "name"
  | "official"
  | "plugin"
  | "pluginId"
  | "releases"
  | "updateVersion"
>) {
  const canOpen = plugin?.lifecycleState === "enabled" && plugin.ui !== null;

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-3">
      {detail ? null : (
        <Link
          aria-label={`${canOpen ? "Open" : "View details for"} ${name}`}
          className="absolute inset-0 rounded-md hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
          to={
            canOpen
              ? pluginPagePath(pluginId)
              : `/customize/plugins/${encodeURIComponent(pluginId)}`
          }
        />
      )}
      <PluginIcon icon={icon} pluginId={pluginId} />
      <div className="min-w-0 flex-1">
        <h2
          className={
            detail
              ? "break-words font-medium text-lg"
              : "break-words font-medium text-sm"
          }
        >
          {name}
          {!detail && plugin?.selectedVersion ? (
            <span className="ml-2 font-mono font-normal text-[11px] text-muted-foreground">
              {plugin.selectedVersion.split("+")[0]}
            </span>
          ) : null}
          {updateVersion ? (
            <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-normal text-[10px] text-primary">
              Update {updateVersion}
            </span>
          ) : null}
        </h2>
        {detail ? (
          <PluginStatusLine official={official} plugin={plugin} />
        ) : (
          <p className="mt-0.5 line-clamp-1 break-words text-muted-foreground text-sm">
            {PLUGIN_DESCRIPTIONS.get(pluginId) ||
              plugin?.description ||
              catalogDescription ||
              releases[0]?.manifest.description}
          </p>
        )}
      </div>
    </div>
  );
}

function PluginStatusLine({
  official,
  plugin,
}: Pick<PluginRowProps, "official" | "plugin">) {
  let status = "Not added";

  if (plugin?.lifecycleState === "enabled") {
    status = "On";
  } else if (plugin?.installed) {
    status = "Off";
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="size-1.5 rounded-full bg-muted-foreground/40 data-[state=enabled]:bg-emerald-500"
          data-state={plugin?.lifecycleState}
        />
        {status}
      </span>
      {official ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
          Built-in
        </span>
      ) : null}
    </div>
  );
}

function PluginRowControls({
  detail,
  plugin,
  pluginId,
  name,
  official,
  busy,
  canManage,
  canManageAgentAccess,
  onAction,
  releases,
  updateVersion,
}: Pick<
  PluginRowProps,
  | "plugin"
  | "detail"
  | "pluginId"
  | "name"
  | "official"
  | "busy"
  | "canManage"
  | "canManageAgentAccess"
  | "onAction"
  | "releases"
  | "updateVersion"
>) {
  const actions = plugin ? pluginRowActions(plugin) : null;
  const canOpen = plugin?.lifecycleState === "enabled" && plugin.ui !== null;
  const canInstall = !plugin?.installed && (official || Boolean(plugin));

  return (
    <div className="flex shrink-0 items-center gap-1">
      {canOpen && detail ? (
        <Button
          nativeButton={false}
          render={<Link to={pluginPagePath(pluginId)} />}
          size="sm"
          variant="outline"
        >
          Open
        </Button>
      ) : null}
      {plugin?.lifecycleState === "enabled" && !detail ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 font-medium text-emerald-700 text-sm dark:text-emerald-400">
          <Tick02Icon aria-hidden="true" className="size-4" />
          Added
        </span>
      ) : null}
      {canManage && (canInstall || actions?.enable) ? (
        <PluginInstallButton
          busy={busy}
          canInstall={canInstall}
          detail={detail}
          name={name}
          onAction={onAction}
        />
      ) : null}
      <PluginRowMenu
        busy={busy}
        canManage={canManage}
        canManageAgentAccess={canManageAgentAccess}
        detail={detail}
        name={name}
        official={official}
        onAction={onAction}
        plugin={plugin}
        pluginId={pluginId}
        releases={releases}
        updateVersion={updateVersion}
      />
    </div>
  );
}

function PluginInstallButton({
  busy,
  canInstall,
  detail,
  name,
  onAction,
}: Pick<PluginRowProps, "busy" | "detail" | "name" | "onAction"> & {
  canInstall: boolean;
}) {
  return (
    <Button
      aria-label={canInstall ? `Add ${name}` : undefined}
      className={canInstall && !detail ? "rounded-full" : undefined}
      disabled={busy}
      onClick={(event) =>
        onAction(canInstall ? "install" : "enable", event.currentTarget)
      }
      size="sm"
      variant={canInstall && !detail ? "outline" : "default"}
    >
      {canInstall && !detail ? (
        <>
          <Add01Icon aria-hidden="true" className="size-4" />
          Add
        </>
      ) : canInstall ? (
        "Add"
      ) : (
        "Turn on"
      )}
    </Button>
  );
}

function pluginMenuActions({
  official,
  plugin,
  releases,
  updateVersion,
}: Pick<PluginRowProps, "official" | "plugin" | "releases" | "updateVersion">) {
  const actions = plugin ? pluginRowActions(plugin) : null;

  const all = [
    ["disable", "Turn off", actions?.disable],
    ["update", "Update", actions?.update || Boolean(updateVersion)],
    ["reinstall", "Reinstall", official && plugin?.installed],
    ["uninstall", "Remove", actions?.uninstall],
    ["purge", "Delete saved data", actions?.purge],
    [
      "remove-plugin",
      "Delete plugin",
      !(official || plugin?.installed) && releases.length > 0,
    ],
    [
      "force-delete",
      "Force delete",
      !official &&
        plugin?.installed &&
        releases.some(
          (item) => item.source === "local" || item.source === "agent"
        ),
    ],
  ] as const;

  return all.filter(([, , visible]) => visible);
}

function PluginRowMenu({
  detail,
  pluginId,
  plugin,
  name,
  official,
  busy,
  canManage,
  canManageAgentAccess,
  onAction,
  releases,
  updateVersion,
}: Pick<
  PluginRowProps,
  | "plugin"
  | "pluginId"
  | "detail"
  | "name"
  | "official"
  | "busy"
  | "canManage"
  | "canManageAgentAccess"
  | "onAction"
  | "releases"
  | "updateVersion"
>) {
  const menuRef = useRef<HTMLButtonElement | null>(null);

  const { pinned, toggle: togglePin } = usePinnedPlugins();
  const canPin = plugin?.lifecycleState === "enabled" && plugin.ui !== null;

  const canManageAccess =
    canManageAgentAccess && plugin?.lifecycleState === "enabled";

  const visibleSecondaryActions = canManage
    ? pluginMenuActions({ official, plugin, releases, updateVersion })
    : [];

  const hasMenu =
    !detail || canPin || canManageAccess || visibleSecondaryActions.length > 0;

  if (!hasMenu) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${name}`}
            disabled={busy}
            ref={menuRef}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {detail ? null : (
          <DropdownMenuItem
            render={
              <Link to={`/customize/plugins/${encodeURIComponent(pluginId)}`} />
            }
          >
            View details
          </DropdownMenuItem>
        )}
        {canPin ? (
          <DropdownMenuItem onClick={() => togglePin(pluginId)}>
            {pinned.includes(pluginId)
              ? "Unpin from sidebar"
              : "Pin to sidebar"}
          </DropdownMenuItem>
        ) : null}
        {canManageAccess ? (
          <DropdownMenuItem
            disabled={busy}
            onClick={() => onAction("access", menuRef.current)}
          >
            Choose agents
          </DropdownMenuItem>
        ) : null}
        {visibleSecondaryActions.map(([type, label]) => (
          <DropdownMenuItem
            disabled={busy}
            key={type}
            onClick={() => onAction(type, menuRef.current)}
            variant={
              type === "purge" ||
              type === "uninstall" ||
              type === "remove-plugin" ||
              type === "force-delete"
                ? "destructive"
                : "default"
            }
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PluginRowDetails({
  plugin,
  pluginId,
  releases,
  busy,
  accessCount,
  onRemove,
}: Pick<
  PluginRowProps,
  "plugin" | "pluginId" | "releases" | "busy" | "accessCount" | "onRemove"
>) {
  return (
    <div className="mt-4">
      <div className="mt-3 border-border border-t pt-3 text-muted-foreground text-xs">
        <p className="break-all">
          {pluginId}
          {plugin?.selectedVersion ? ` · ${plugin.selectedVersion}` : ""}
        </p>
        {accessCount !== undefined && plugin?.lifecycleState === "enabled" ? (
          <p className="mt-2">
            Used by {accessCount} {accessCount === 1 ? "agent" : "agents"}
          </p>
        ) : null}
        {plugin?.description ? (
          <p className="mt-2">{plugin.description}</p>
        ) : null}
        <PluginReleasesList
          busy={busy}
          onRemove={onRemove}
          plugins={plugin ? [plugin] : []}
          releases={releases}
        />
      </div>
    </div>
  );
}

export function PluginAgentAccessDialog({
  plugin,
  onClose,
}: {
  plugin: OrgPluginDetail;
  onClose(): void;
}) {
  const access = usePluginAgentAccess();
  const save = useSavePluginAgentAccess();
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const data = access.data;

  const hasResources =
    data &&
    [...data.tools, ...data.skills].some(
      (item) => item.pluginId === plugin.pluginId
    );

  const busy = save.isPending;

  const pendingChanges = Object.fromEntries(
    Object.entries(changes).filter(([id, selected]) => {
      const profile = data?.profiles.find((item) => item.id === id);

      if (!(profile && data)) {
        return false;
      }

      const state = pluginAgentAccessState(profile, plugin.pluginId, data);

      return selected ? !state.full : state.assigned > 0;
    })
  );

  async function onSave() {
    try {
      await save.mutateAsync({
        changes: pendingChanges,
        pluginId: plugin.pluginId,
      });
      onClose();
    } catch {
      // Keep the selection available for retry after refreshing assignments.
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose agents that can use this plugin</DialogTitle>
          <DialogDescription>
            {plugin.name} — selected agents receive all of this plugin’s tools
            and skills.
          </DialogDescription>
        </DialogHeader>
        {access.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {access.error ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm" role="alert">
              {formatError(access.error)}
            </p>
            <Button
              disabled={access.isFetching}
              onClick={() => void access.refetch()}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {data &&
          !access.error &&
          (hasResources ? (
            <PluginAgentAccessList
              busy={busy}
              changes={changes}
              data={data}
              pluginId={plugin.pluginId}
              setChanges={setChanges}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              This plugin has nothing for agents to use.
            </p>
          ))}
        {save.error ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(save.error)} Some changes may have been saved. Review
            the selection and retry.
          </p>
        ) : null}
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              access.isFetching ||
              Boolean(access.error) ||
              !hasResources ||
              Object.keys(pendingChanges).length === 0
            }
            onClick={() => void onSave()}
          >
            {busy ? <Spinner className="size-4" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PluginAgentAccessList({
  busy,
  changes,
  data,
  pluginId,
  setChanges,
}: {
  busy: boolean;
  changes: Record<string, boolean>;
  data: NonNullable<ReturnType<typeof usePluginAgentAccess>["data"]>;
  pluginId: string;
  setChanges: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const [query, setQuery] = useState("");

  const profiles = data.profiles;

  const isSelected = (profile: (typeof profiles)[number]) =>
    changes[profile.id] ?? pluginAgentAccessState(profile, pluginId, data).full;

  const needle = query.trim().toLowerCase();

  const shown = profiles.filter((profile) =>
    profile.name.toLowerCase().includes(needle)
  );

  const selectedCount = profiles.filter(isSelected).length;

  const allShownSelected = shown.length > 0 && shown.every(isSelected);
  const someShownSelected = shown.some(isSelected);

  function selectShown(selected: boolean) {
    setChanges((current) => ({
      ...current,
      ...Object.fromEntries(shown.map((profile) => [profile.id, selected])),
    }));
  }

  return (
    <div className="space-y-3">
      {profiles.length > 0 ? (
        <>
          <div className="relative">
            <Search01Icon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search agents"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              value={query}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-border border-y px-2 py-1.5">
            <label className="flex cursor-pointer items-center gap-3 font-medium text-sm">
              <Checkbox
                checked={allShownSelected}
                disabled={busy || shown.length === 0}
                indeterminate={someShownSelected && !allShownSelected}
                onCheckedChange={selectShown}
              />
              Select all
            </label>
            <span className="text-muted-foreground text-xs">
              {selectedCount} of {profiles.length} selected
            </span>
          </div>
        </>
      ) : null}
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {profiles.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">
            No agents in this organization.
          </p>
        ) : null}
        {profiles.length > 0 && shown.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            No agents match.
          </p>
        ) : null}
        {shown.map((profile) => {
          const state = pluginAgentAccessState(profile, pluginId, data);

          const partial =
            changes[profile.id] === undefined &&
            state.assigned > 0 &&
            !state.full;

          return (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
              key={profile.id}
            >
              <Checkbox
                checked={changes[profile.id] ?? state.full}
                disabled={busy}
                indeterminate={partial}
                onCheckedChange={(checked) =>
                  setChanges((current) => ({
                    ...current,
                    [profile.id]: checked,
                  }))
                }
              />
              <ProfileAvatar profile={profile} size="sm" />
              <span className="min-w-0 flex-1 break-words text-sm">
                {profile.name}
              </span>
              {partial ? (
                <span className="text-muted-foreground text-xs">
                  Partial access
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PluginIcon({ icon, pluginId }: { icon?: string; pluginId: string }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const Icon = pluginIcon(pluginId);

  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-foreground">
      {icon && icon !== failedIcon ? (
        <img
          alt=""
          className="size-full object-contain"
          height={40}
          onError={() => setFailedIcon(icon)}
          referrerPolicy="no-referrer"
          src={icon}
          width={40}
        />
      ) : (
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      )}
    </div>
  );
}

function PluginConfirmDialog({
  dialog,
  busy,
  error,
  onClose,
  onConfirm,
  onPreview,
}: {
  dialog: PluginDialog | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onPreview(source: PluginPackageRequest): void;
}) {
  const title = dialogTitle(dialog);
  const { blocked, inUse } = useRemovalBlockers(dialog);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onClose();
        }
      }}
      open={dialog !== null}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {dialog?.type === "package" ? (
            <DialogDescription>
              Install only plugins from people you trust. A plugin can see and
              change all data on this server, in every organization.
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {error ? (
          <p className="break-words text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {dialog?.type === "package-entry" ? (
          <PluginPackageForm
            busy={busy}
            onClose={onClose}
            onPreview={onPreview}
          />
        ) : (
          <>
            {inUse ? <PluginUsageList {...inUse} /> : null}
            {dialog && !blocked ? <DialogBody dialog={dialog} /> : null}
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={onClose}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={busy || blocked}
                onClick={onConfirm}
                type="button"
              >
                {busy ? <Spinner className="size-4" /> : null}
                {confirmLabel(dialog)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Organizations that still hold the plugin a delete dialog would remove. */
function useRemovalBlockers(dialog: PluginDialog | null) {
  const pluginId = dialog?.type === "remove-plugin" ? dialog.pluginId : null;
  const usage = usePluginUsage(pluginId);
  const orgs = usage.data?.orgs ?? [];

  return {
    blocked: Boolean(pluginId) && (usage.isPending || orgs.length > 0),
    inUse: pluginId && orgs.length > 0 ? { orgs, pluginId } : null,
  };
}

function PluginUsageList({
  orgs,
  pluginId,
}: {
  orgs: PluginUsageOrg[];
  pluginId: string;
}) {
  const unplug = useUnplugPlugin();

  return (
    <div className="min-w-0 space-y-3">
      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-900 text-sm dark:text-amber-200">
        Still in use. Unplug it from each organization below, then delete.
      </p>
      {unplug.error ? (
        <p className="break-words text-destructive text-sm" role="alert">
          {formatError(unplug.error)}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {orgs.map((org) => (
          <li className="flex flex-wrap items-center gap-3 p-3" key={org.orgId}>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="break-words font-medium text-sm">{org.name}</p>
              {org.agents.length > 0 ? (
                <ul
                  aria-label="Agents using it"
                  className="flex flex-wrap gap-1.5"
                >
                  {org.agents.map((agent) => (
                    <li
                      className="rounded-full bg-muted px-2 py-0.5 text-xs"
                      key={agent.id}
                    >
                      {agent.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No agents use it
                </p>
              )}
            </div>
            <Button
              disabled={unplug.isPending}
              onClick={() => unplug.mutate({ org, pluginId })}
              size="sm"
              type="button"
              variant="outline"
            >
              {unplug.isPending && unplug.variables?.org.orgId === org.orgId ? (
                <Spinner className="size-4" />
              ) : null}
              Unplug and delete data
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DialogBody({
  dialog,
}: {
  dialog: Exclude<PluginDialog, { type: "package-entry" }>;
}) {
  if (dialog.type === "official-install") {
    return <p className="text-sm">{dialog.description}</p>;
  }

  if (dialog.type === "package") {
    return (
      <ul className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
        <li>
          {dialog.source.packageName}@{dialog.source.version}
        </li>
        {formatPluginTrustLines(dialog.preview).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
  }

  if (dialog.type === "update") {
    return (
      <div className="space-y-1 text-sm">
        <p>
          {dialog.plugin.name} → {dialog.targetVersion}
        </p>
        {dialog.preview.removedSkillKeys.length > 0 ? (
          <p>
            These skills go away: {dialog.preview.removedSkillKeys.join(", ")}
          </p>
        ) : null}
        {dialog.preview.removedActionKeys.length > 0 ? (
          <p>
            These actions go away: {dialog.preview.removedActionKeys.join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  if (dialog.type === "purge") {
    return (
      <p className="text-sm">
        This deletes all data that {dialog.plugin.name} saved. You cannot undo
        this.
      </p>
    );
  }

  if (dialog.type === "force-delete") {
    return (
      <p className="text-sm">
        This removes {dialog.pluginId} from every organization, deletes its
        saved data, and deletes all {dialog.versions.length} version
        {dialog.versions.length === 1 ? "" : "s"}. You cannot undo this.
      </p>
    );
  }

  if (dialog.type === "remove-plugin") {
    return (
      <p className="text-sm">
        This deletes {dialog.pluginId} and{" "}
        {dialog.versions.length === 1
          ? "its only version"
          : `all ${dialog.versions.length} versions`}
        .
      </p>
    );
  }

  if (dialog.type === "remove-release") {
    return (
      <p className="text-sm">
        {dialog.pluginId}, version {dialog.version}
      </p>
    );
  }

  return (
    <p className="text-sm">
      {dialog.type === "uninstall"
        ? `${dialog.plugin.name} stops working for everyone. Its saved data is kept.`
        : dialog.plugin.name}
    </p>
  );
}

function dialogTitle(dialog: PluginDialog | null): string {
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

function confirmLabel(dialog: PluginDialog | null): string {
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
