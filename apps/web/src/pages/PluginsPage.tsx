import type {
  OrgPluginDetail,
  PluginContributionChangePreview,
  PluginPackagePreviewResponse,
  PluginPackageRequest,
  PluginReleaseSummary,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
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
import { Spinner } from "@nakama/ui/spinner";
import { MoreHorizontalIcon } from "hugeicons-react";
import { type MouseEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import {
  formatPluginTrustLines,
  isPluginLifecycleBusy,
  nextPluginVersions,
  pluginAgentAccessState,
  pluginRowActions,
  useDeleteRetainedPluginData,
  useDisableOrgPlugin,
  useEnableOrgPlugin,
  useInstallOfficialPlugin,
  useInstallOrgPlugin,
  useInstallPluginPackage,
  useOfficialPlugins,
  useOrgPlugins,
  usePluginAgentAccess,
  usePluginReleases,
  usePreviewOrgPluginUpdate,
  usePreviewPluginPackage,
  useReinstallOfficialPlugin,
  useRemovePluginRelease,
  useSavePluginAgentAccess,
  useUninstallOrgPlugin,
  useUpdateOrgPlugin,
} from "@/hooks/use-plugins";
import { formatError } from "@/lib/client";
import {
  canAccessSystemPage,
  canManagePluginReleases,
  pluginIcon,
  pluginPagePath,
} from "@/lib/navigation";

type PluginDialog =
  | { type: "package-entry" }
  | {
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
  | { pluginId: string; type: "remove-release"; version: string };

export function PluginsPage() {
  const { user, activeOrg } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canManage = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const canInstallPackages = canManagePluginReleases(isPlatformAdmin);
  const orgId = activeOrg?.id ?? "";
  const { data: plugins = [], isLoading, error } = useOrgPlugins();
  const releasesQuery = usePluginReleases(canInstallPackages);
  const officialQuery = useOfficialPlugins();
  const installOfficial = useInstallOfficialPlugin();
  const official = officialQuery.data?.plugins ?? [];
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
  const reinstallOfficial = useReinstallOfficialPlugin();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<PluginDialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [accessDialog, setAccessDialog] = useState<{
    orgId: string;
    plugin: OrgPluginDetail;
  } | null>(null);
  const agentAccess = usePluginAgentAccess();
  const accessData = isPlatformAdmin ? agentAccess.data : undefined;

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

  async function previewNpmPackage(source: PluginPackageRequest) {
    if (!canInstallPackages) {
      return;
    }
    setActionError(null);
    try {
      const preview = await previewPackage.mutateAsync(source);
      setDialog({ preview, source, type: "package" });
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
      if (dialog.type === "package") {
        await installPackage.mutateAsync({
          expectedDigest: dialog.preview.digest,
          expectedIntegrity: dialog.preview.integrity,
          ...dialog.source,
        });
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
        await updateOrg.mutateAsync({
          pluginId: dialog.plugin.pluginId,
          request: {
            expectedRevision: dialog.plugin.revision,
            targetVersion: dialog.targetVersion,
          },
        });
      } else if (dialog.type === "uninstall") {
        await uninstallOrg.mutateAsync({
          expectedRevision: dialog.plugin.revision,
          pluginId: dialog.plugin.pluginId,
        });
      } else if (dialog.type === "purge") {
        await purgeData.mutateAsync({
          confirm: true,
          expectedRevision: dialog.plugin.revision,
          orgId,
          pluginId: dialog.plugin.pluginId,
        });
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

  if (isLoading && plugins.length === 0) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground text-sm">
        <Spinner className="size-5" />
      </div>
    );
  }

  const queryError =
    error ??
    officialQuery.error ??
    (canInstallPackages ? releasesQuery.error : null);
  const errorMessage =
    actionError ?? (queryError ? formatError(queryError) : null);

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-section-title">Plugins</h2>
        {canInstallPackages ? (
          <Button
            disabled={busy}
            onClick={(event) => {
              rememberFocus(event.currentTarget);
              setActionError(null);
              setDialog({ type: "package-entry" });
            }}
            size="sm"
          >
            Install external plugin
          </Button>
        ) : null}
      </div>

      {errorMessage && !dialog ? (
        <p
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      {pluginIds.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground text-sm">
          {officialQuery.isLoading
            ? "Loading plugins…"
            : "No plugins available."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {pluginIds.map((pluginId) => {
            const plugin = plugins.find((item) => item.pluginId === pluginId);
            const catalog = official.find((item) => item.id === pluginId);
            const pluginReleases = releases.filter(
              (item) => item.pluginId === pluginId
            );
            return (
              <PluginRow
                accessCount={accessData?.counts[pluginId]}
                busy={busy || Boolean(plugin && isPluginLifecycleBusy(plugin))}
                canManage={canManage}
                canManageAgentAccess={isPlatformAdmin}
                icon={
                  plugin?.icon ??
                  catalog?.icon ??
                  pluginReleases[0]?.manifest.icon
                }
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
                    void installOfficial
                      .mutateAsync(pluginId)
                      .catch((err) => setActionError(formatError(err)));
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
              />
            );
          })}
        </ul>
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
        orgId={orgId}
      />
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
              Remove release
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
  icon?: string;
  name: string;
  official: boolean;
  onAction(
    type:
      | Exclude<
          PluginDialog["type"],
          "package" | "package-entry" | "remove-release"
        >
      | "reinstall"
      | "access",
    target: HTMLElement | null
  ): void;
  onRemove(release: PluginReleaseSummary, event: MouseEvent<HTMLElement>): void;
  plugin?: OrgPluginDetail;
  pluginId: string;
  releases: PluginReleaseSummary[];
}

function PluginRow({
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
}: PluginRowProps) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-center gap-3">
        <PluginIcon icon={icon} pluginId={pluginId} />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-sm">{name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span className="inline-flex items-center gap-1.5 capitalize">
              <span
                className={
                  plugin?.lifecycleState === "enabled"
                    ? "size-1.5 rounded-full bg-emerald-500"
                    : "size-1.5 rounded-full bg-muted-foreground/40"
                }
              />
              {plugin?.lifecycleState ?? "Available"}
            </span>
            {official ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                Official
              </span>
            ) : null}
          </div>
        </div>
        <PluginRowControls
          busy={busy}
          canManage={canManage}
          canManageAgentAccess={canManageAgentAccess}
          name={name}
          official={official}
          onAction={onAction}
          plugin={plugin}
          pluginId={pluginId}
        />
      </div>
      {plugin?.lastLifecycleError ? (
        <p className="mt-2 break-words text-destructive text-xs" role="alert">
          {plugin.lastLifecycleError}
        </p>
      ) : null}
      <PluginRowDetails
        accessCount={accessCount}
        busy={busy}
        onRemove={onRemove}
        plugin={plugin}
        pluginId={pluginId}
        releases={releases}
      />
    </li>
  );
}

function PluginRowControls({
  plugin,
  pluginId,
  name,
  official,
  busy,
  canManage,
  canManageAgentAccess,
  onAction,
}: Pick<
  PluginRowProps,
  | "plugin"
  | "pluginId"
  | "name"
  | "official"
  | "busy"
  | "canManage"
  | "canManageAgentAccess"
  | "onAction"
>) {
  const actions = plugin ? pluginRowActions(plugin) : null;
  const canOpen = plugin?.lifecycleState === "enabled" && plugin.ui !== null;
  const canInstall = !plugin?.installed && (official || Boolean(plugin));
  return (
    <div className="flex shrink-0 items-center gap-1">
      {canOpen ? (
        <Button
          nativeButton={false}
          render={<Link to={pluginPagePath(pluginId)} />}
          size="sm"
          variant="outline"
        >
          Open
        </Button>
      ) : null}
      {canManage && (canInstall || actions?.enable) ? (
        <Button
          disabled={busy}
          onClick={(event) =>
            onAction(canInstall ? "install" : "enable", event.currentTarget)
          }
          size="sm"
        >
          {canInstall ? "Install" : "Enable"}
        </Button>
      ) : null}
      <PluginRowMenu
        busy={busy}
        canManage={canManage}
        canManageAgentAccess={canManageAgentAccess}
        name={name}
        official={official}
        onAction={onAction}
        plugin={plugin}
      />
    </div>
  );
}

function PluginRowMenu({
  plugin,
  name,
  official,
  busy,
  canManage,
  canManageAgentAccess,
  onAction,
}: Pick<
  PluginRowProps,
  | "plugin"
  | "name"
  | "official"
  | "busy"
  | "canManage"
  | "canManageAgentAccess"
  | "onAction"
>) {
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const actions = plugin ? pluginRowActions(plugin) : null;
  const secondaryActions = [
    ["disable", "Disable", actions?.disable],
    ["update", "Update", actions?.update],
    ["reinstall", "Reinstall", official && plugin?.installed],
    ["uninstall", "Uninstall", actions?.uninstall],
    ["purge", "Delete data", actions?.purge],
  ] as const;
  const hasMenu =
    (canManageAgentAccess && plugin?.lifecycleState === "enabled") ||
    (canManage && secondaryActions.some(([, , visible]) => visible));
  return hasMenu ? (
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
        {canManageAgentAccess && plugin?.lifecycleState === "enabled" ? (
          <DropdownMenuItem
            disabled={busy}
            onClick={() => onAction("access", menuRef.current)}
          >
            Manage agent access
          </DropdownMenuItem>
        ) : null}
        {secondaryActions
          .filter(([, , visible]) => canManage && visible)
          .map(([type, label]) => (
            <DropdownMenuItem
              disabled={busy}
              key={type}
              onClick={() => onAction(type, menuRef.current)}
              variant={
                type === "purge" || type === "uninstall"
                  ? "destructive"
                  : "default"
              }
            >
              {label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
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
  return plugin || releases.length > 0 ? (
    <details className="mt-3 sm:ml-13">
      <summary className="w-fit cursor-pointer rounded text-muted-foreground text-xs hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Details
      </summary>
      <div className="mt-3 border-border border-t pt-3 text-muted-foreground text-xs">
        <p className="break-all">
          {pluginId}
          {plugin?.selectedVersion ? ` · ${plugin.selectedVersion}` : ""}
        </p>
        {accessCount !== undefined && plugin?.lifecycleState === "enabled" ? (
          <p className="mt-2">
            Available to {accessCount} {accessCount === 1 ? "agent" : "agents"}
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
    </details>
  ) : null;
}

function PluginAgentAccessDialog({
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
          <DialogTitle>Manage agent access</DialogTitle>
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
        {data && !access.error ? (
          hasResources ? (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {data.profiles.length === 0 ? (
                <p className="py-4 text-muted-foreground text-sm">
                  No agents in this organization.
                </p>
              ) : null}
              {data.profiles.map((profile) => {
                const state = pluginAgentAccessState(
                  profile,
                  plugin.pluginId,
                  data
                );
                const partial =
                  changes[profile.id] === undefined &&
                  state.assigned > 0 &&
                  !state.full;
                return (
                  <label
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
                    key={profile.id}
                  >
                    <input
                      checked={changes[profile.id] ?? state.full}
                      className="size-4 shrink-0 accent-primary"
                      disabled={busy}
                      onChange={(event) =>
                        setChanges((current) => ({
                          ...current,
                          [profile.id]: event.target.checked,
                        }))
                      }
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = partial;
                        }
                      }}
                      type="checkbox"
                    />
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
          ) : (
            <p className="text-muted-foreground text-sm">
              This plugin has no tools or skills to assign.
            </p>
          )
        ) : null}
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

function PluginIcon({ icon, pluginId }: { icon?: string; pluginId: string }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const Icon = pluginIcon(pluginId);
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden text-foreground">
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
  orgId,
  onClose,
  onConfirm,
  onPreview,
}: {
  dialog: PluginDialog | null;
  busy: boolean;
  error: string | null;
  orgId: string;
  onClose: () => void;
  onConfirm: () => void;
  onPreview(source: PluginPackageRequest): void;
}) {
  const title = dialogTitle(dialog);
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
              Trust this author with the Nakama server and your signed-in
              browser. Plugin code is not sandboxed and can access data across
              organizations.
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
            {dialog ? <DialogBody dialog={dialog} orgId={orgId} /> : null}
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={onClose}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={onConfirm} type="button">
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

function DialogBody({
  dialog,
  orgId,
}: {
  dialog: Exclude<PluginDialog, { type: "package-entry" }>;
  orgId: string;
}) {
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
          <p>Removes skills {dialog.preview.removedSkillKeys.join(", ")}</p>
        ) : null}
        {dialog.preview.removedActionKeys.length > 0 ? (
          <p>Removes actions {dialog.preview.removedActionKeys.join(", ")}</p>
        ) : null}
      </div>
    );
  }

  if (dialog.type === "purge") {
    return (
      <p className="text-sm">
        {dialog.plugin.pluginId} in {orgId}, revision {dialog.plugin.revision}
      </p>
    );
  }

  if (dialog.type === "remove-release") {
    return (
      <p className="text-sm">
        {dialog.pluginId} {dialog.version}
      </p>
    );
  }

  return (
    <p className="text-sm">
      {dialog.plugin.name} ({dialog.plugin.pluginId}), revision{" "}
      {dialog.plugin.revision}
    </p>
  );
}

function dialogTitle(dialog: PluginDialog | null): string {
  if (!dialog) {
    return "Plugin";
  }
  if (dialog.type === "package-entry") {
    return "Install external plugin";
  }
  if (dialog.type === "package") {
    return "Install this package?";
  }
  if (dialog.type === "install") {
    return "Install in this org?";
  }
  if (dialog.type === "enable") {
    return "Enable this plugin?";
  }
  if (dialog.type === "disable") {
    return "Disable this plugin?";
  }
  if (dialog.type === "update") {
    return "Update this plugin?";
  }
  if (dialog.type === "uninstall") {
    return "Uninstall this plugin?";
  }
  if (dialog.type === "purge") {
    return "Delete retained plugin data?";
  }
  return "Remove this release?";
}

function confirmLabel(dialog: PluginDialog | null): string {
  if (!dialog) {
    return "Confirm";
  }
  if (dialog.type === "package" || dialog.type === "install") {
    return "Install";
  }
  if (dialog.type === "enable") {
    return "Enable";
  }
  if (dialog.type === "disable") {
    return "Disable";
  }
  if (dialog.type === "update") {
    return "Update";
  }
  if (dialog.type === "uninstall") {
    return "Uninstall";
  }
  if (dialog.type === "purge") {
    return "Delete data";
  }
  return "Remove";
}
