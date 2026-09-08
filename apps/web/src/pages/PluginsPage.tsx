import type {
  OrgPluginDetail,
  PluginContributionChangePreview,
  PluginPackagePreviewResponse,
} from "@nakama/core/contract";
import { Add01Icon } from "hugeicons-react";
import { type MouseEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import {
  formatPluginTrustLines,
  isPluginLifecycleBusy,
  nextPluginVersions,
  pluginRowActions,
  useDeleteRetainedPluginData,
  useDisableOrgPlugin,
  useEnableOrgPlugin,
  useInstallOrgPlugin,
  useInstallPluginPackage,
  useOrgPlugins,
  usePluginReleases,
  usePreviewOrgPluginUpdate,
  usePreviewPluginPackage,
  useRemovePluginRelease,
  useUninstallOrgPlugin,
  useUpdateOrgPlugin,
} from "@/hooks/use-plugins";
import { formatError } from "@/lib/client";
import {
  canAccessSystemPage,
  canManagePluginReleases,
  PAGE_PATHS,
  pluginPagePath,
} from "@/lib/navigation";

type PluginDialog =
  | {
      file: Blob;
      preview: PluginPackagePreviewResponse;
      type: "upload";
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
  const canUpload = canManagePluginReleases(isPlatformAdmin);
  const orgId = activeOrg?.id ?? "";
  const { data: plugins = [], isLoading, error } = useOrgPlugins();
  const releasesQuery = usePluginReleases(canUpload);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<PluginDialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
  ].some((mutation) => mutation.isPending);

  function rememberFocus(target: EventTarget | null) {
    if (target instanceof HTMLElement) {
      restoreFocusRef.current = target;
    }
  }

  function closeDialog() {
    setDialog(null);
    queueMicrotask(() => restoreFocusRef.current?.focus());
  }

  async function handleUploadFile(file: File | undefined) {
    if (!(file && canUpload)) {
      return;
    }

    setActionError(null);
    try {
      const preview = await previewPackage.mutateAsync(file);
      setDialog({ file, preview, type: "upload" });
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
    if (!dialog) {
      return;
    }

    setActionError(null);
    try {
      if (dialog.type === "upload") {
        await installPackage.mutateAsync({
          expectedDigest: dialog.preview.digest,
          file: dialog.file,
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

  const errorMessage = actionError ?? (error ? formatError(error) : null);

  return (
    <div className="min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="type-section-title">Plugins</h2>
        {canUpload ? (
          <>
            <Button
              disabled={busy}
              onClick={(event) => {
                rememberFocus(event.currentTarget);
                fileInputRef.current?.click();
              }}
              size="sm"
              type="button"
            >
              <Add01Icon
                aria-hidden
                className="size-4"
                data-icon="inline-start"
              />
              Upload plugin
            </Button>
            <input
              accept=".zip,application/zip"
              aria-label="Upload plugin package"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void handleUploadFile(file);
              }}
              ref={fileInputRef}
              type="file"
            />
          </>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      {plugins.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground text-sm">
          {canUpload ? "Upload a plugin package." : "No plugins in this org."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {plugins.map((plugin) => (
            <PluginRow
              busy={busy || isPluginLifecycleBusy(plugin)}
              canManage={canManage}
              canUpload={canUpload}
              key={plugin.pluginId}
              onAction={(type, event) => {
                rememberFocus(event.currentTarget);
                if (type === "update") {
                  const version = nextPluginVersions(plugin)[0];
                  if (version) {
                    void handleUpdate(plugin, version);
                  }
                  return;
                }
                setDialog({ plugin, type });
              }}
              plugin={plugin}
            />
          ))}
        </ul>
      )}

      {canUpload && (releasesQuery.data?.releases.length ?? 0) > 0 ? (
        <ul className="mt-6 divide-y divide-border rounded-md border border-border">
          {releasesQuery.data?.releases.map((release) => {
            const inUse = plugins.some(
              (plugin) =>
                plugin.pluginId === release.pluginId &&
                plugin.selectedVersion === release.version &&
                plugin.installed
            );
            return (
              <li
                className="flex items-center justify-between gap-3 px-4 py-3"
                key={`${release.pluginId}@${release.version}`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {release.manifest.name} {release.version}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {release.pluginId}
                  </p>
                </div>
                <Button
                  disabled={busy || inUse}
                  onClick={(event) => {
                    rememberFocus(event.currentTarget);
                    setDialog({
                      pluginId: release.pluginId,
                      type: "remove-release",
                      version: release.version,
                    });
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
      ) : null}

      <PluginConfirmDialog
        busy={busy}
        dialog={dialog}
        onClose={closeDialog}
        onConfirm={() => void confirmDialog()}
        orgId={orgId}
      />
    </div>
  );
}

function PluginRow({
  plugin,
  busy,
  canManage,
  canUpload,
  onAction,
}: {
  plugin: OrgPluginDetail;
  busy: boolean;
  canManage: boolean;
  canUpload: boolean;
  onAction: (
    type:
      | Exclude<PluginDialog["type"], "upload" | "remove-release" | "update">
      | "update",
    event: MouseEvent<HTMLButtonElement>
  ) => void;
}) {
  const actions = pluginRowActions(plugin);
  const canOpen = plugin.lifecycleState === "enabled" && plugin.ui !== null;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-sm">{plugin.name}</p>
        <p className="text-muted-foreground text-xs">
          {plugin.pluginId}
          {plugin.selectedVersion ? ` · ${plugin.selectedVersion}` : ""}
          {` · ${plugin.lifecycleState}`}
          {plugin.ui ? "" : " · no page"}
        </p>
        {plugin.lastLifecycleError ? (
          <p className="mt-1 text-destructive text-xs">
            {plugin.lastLifecycleError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {canOpen ? (
          <Button
            render={<Link to={pluginPagePath(plugin.pluginId)} />}
            size="sm"
          >
            Open
          </Button>
        ) : null}
        {plugin.lifecycleState === "enabled" ? (
          <Button
            disabled={busy}
            render={<Link to={PAGE_PATHS.profiles} />}
            size="sm"
            variant="outline"
          >
            Assign
          </Button>
        ) : null}
        {canManage
          ? (
              [
                ["install", "Install", !plugin.installed, "default"],
                ["enable", "Enable", actions.enable, "default"],
                ["disable", "Disable", actions.disable, "outline"],
                ["update", "Update", actions.update, "outline"],
                ["uninstall", "Uninstall", actions.uninstall, "ghost"],
                ["purge", "Delete data", actions.purge, "ghost"],
              ] as const
            )
              .filter(([, , visible]) => visible)
              .map(([type, label, , variant]) => (
                <Button
                  disabled={busy}
                  key={type}
                  onClick={(event) => onAction(type, event)}
                  size="sm"
                  type="button"
                  variant={variant}
                >
                  {label}
                </Button>
              ))
          : null}
        {canUpload ? <span className="sr-only">{plugin.revision}</span> : null}
      </div>
    </li>
  );
}

function PluginConfirmDialog({
  dialog,
  busy,
  orgId,
  onClose,
  onConfirm,
}: {
  dialog: PluginDialog | null;
  busy: boolean;
  orgId: string;
  onClose: () => void;
  onConfirm: () => void;
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
          {dialog?.type === "upload" ? (
            <DialogDescription>
              Trust this author with the Nakama server and your signed-in
              browser. Plugin code is not sandboxed and can access data across
              organizations.
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  dialog,
  orgId,
}: {
  dialog: PluginDialog;
  orgId: string;
}) {
  if (dialog.type === "upload") {
    return (
      <ul className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
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
  if (dialog.type === "upload") {
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
  if (dialog.type === "upload" || dialog.type === "install") {
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
