import type {
  PluginPackageRequest,
  PluginUsageOrg,
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
import { Spinner } from "@nakama/ui/spinner";
import { formatPluginTrustLines, useUnplugPlugin } from "@/hooks/use-plugins";
import { formatError } from "@/lib/client";
import { PluginPackageForm } from "@/pages/plugins/local-plugin-installer";
import {
  confirmLabel,
  dialogTitle,
  type PluginDialog,
  useRemovalBlockers,
} from "@/pages/plugins/use-plugin-management";

export function PluginConfirmDialog({
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

  return <RemovalDialogBody dialog={dialog} />;
}

function RemovalDialogBody({
  dialog,
}: {
  dialog: Exclude<
    PluginDialog,
    { type: "package-entry" | "official-install" | "package" | "update" }
  >;
}) {
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
