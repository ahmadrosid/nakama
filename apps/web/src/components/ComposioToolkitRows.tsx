import type {
  ComposioCatalogToolkitSummary,
  ComposioUserConnectionStatus,
  ListComposioToolkitsResponse,
  ProfileSummary,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { cn } from "@nakama/ui/utils";
import { MoreHorizontalIcon } from "hugeicons-react";
import { ComposioProfileAssignPicker } from "@/components/ComposioProfileAssignPicker";
import { ComposioToolkitLogo } from "@/components/ComposioToolkitLogo";
import type { ToolkitRowModel } from "@/lib/composio-toolkit-rows";

function userConnectionLabel(
  status: ComposioUserConnectionStatus | undefined
): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "oauth_in_progress":
      return "Connecting…";
    case "error":
      return "Error";
    default:
      return "Not connected";
  }
}

function userConnectionTone(
  status: ComposioUserConnectionStatus | undefined
): "success" | "warning" | "error" | "muted" {
  switch (status) {
    case "connected":
      return "success";
    case "oauth_in_progress":
      return "warning";
    case "error":
      return "error";
    default:
      return "muted";
  }
}

const STATUS_TEXT = {
  error: "text-destructive",
  muted: "text-muted-foreground",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
} as const;

const STATUS_DOT = {
  error: "bg-destructive",
  muted: "bg-muted-foreground/50",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
} as const;

interface ComposioToolkitRowProps {
  assignedProfileIds: string[];
  busy: boolean;
  isOrgAdmin: boolean;
  onConnect: (slug: string) => void;
  onDisable: (slug: string) => void;
  onDisconnect: (slug: string) => void;
  onEnable: (slug: string) => void;
  onSync: (slug: string) => void;
  onToggleProfile: (
    profileId: string,
    toolkitId: string,
    assigned: boolean
  ) => void;
  profiles: ProfileSummary[];
  row: ToolkitRowModel;
}

function ComposioToolkitRowStatus({
  lastError,
  orgEnabled,
  userStatus,
}: {
  lastError: string | null;
  orgEnabled: boolean;
  userStatus: ComposioUserConnectionStatus | undefined;
}) {
  const tone = orgEnabled ? userConnectionTone(userStatus) : "muted";

  return (
    <>
      <p
        className={cn(
          "mt-0.5 flex items-center gap-1.5 text-xs",
          STATUS_TEXT[tone]
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[tone])}
        />
        {orgEnabled ? userConnectionLabel(userStatus) : "Not enabled"}
      </p>
      {lastError ? (
        <p className="mt-1 truncate text-destructive text-xs">{lastError}</p>
      ) : null}
    </>
  );
}

function ComposioToolkitRowActions({
  assignedProfileIds,
  busy,
  catalogName,
  catalogSlug,
  isOrgAdmin,
  onConnect,
  onDisable,
  onDisconnect,
  onEnable,
  onSync,
  onToggleProfile,
  orgEnabled,
  orgToolkitId,
  profiles,
  userStatus,
}: {
  assignedProfileIds: string[];
  busy: boolean;
  catalogName: string;
  catalogSlug: string;
  isOrgAdmin: boolean;
  onConnect: (slug: string) => void;
  onDisable: (slug: string) => void;
  onDisconnect: (slug: string) => void;
  onEnable: (slug: string) => void;
  onSync: (slug: string) => void;
  onToggleProfile: (
    profileId: string,
    toolkitId: string,
    assigned: boolean
  ) => void;
  orgEnabled: boolean;
  orgToolkitId: string | undefined;
  profiles: ProfileSummary[];
  userStatus: ComposioUserConnectionStatus | undefined;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {isOrgAdmin && !orgEnabled ? (
        <Button
          disabled={busy}
          onClick={() => onEnable(catalogSlug)}
          size="sm"
          type="button"
        >
          Enable
        </Button>
      ) : null}

      {orgEnabled && userStatus === "connected" ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Toolkit actions"
                disabled={busy}
                size="icon-sm"
                type="button"
                variant="outline"
              />
            }
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSync(catalogSlug)}>
              Sync tools
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDisconnect(catalogSlug)}>
              Disconnect
            </DropdownMenuItem>
            {isOrgAdmin ? (
              <DropdownMenuItem onClick={() => onDisable(catalogSlug)}>
                Disable for org
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {isOrgAdmin && orgEnabled && orgToolkitId ? (
        <ComposioProfileAssignPicker
          assignedProfileIds={assignedProfileIds}
          busy={busy}
          onToggle={(profileId, assigned) =>
            onToggleProfile(profileId, orgToolkitId, assigned)
          }
          profiles={profiles}
          toolkitName={catalogName}
        />
      ) : null}

      {orgEnabled && userStatus !== "connected" ? (
        <Button
          disabled={busy}
          onClick={() => onConnect(catalogSlug)}
          size="sm"
          type="button"
        >
          {userStatus === "oauth_in_progress" ? "Finish connecting" : "Connect"}
        </Button>
      ) : null}

      {isOrgAdmin && orgEnabled && userStatus !== "connected" ? (
        <Button
          disabled={busy}
          onClick={() => onDisable(catalogSlug)}
          size="sm"
          type="button"
          variant="outline"
        >
          Disable
        </Button>
      ) : null}
    </div>
  );
}

function ComposioToolkitRow({
  row,
  isOrgAdmin,
  busy,
  assignedProfileIds,
  profiles,
  onToggleProfile,
  onConnect,
  onEnable,
  onDisable,
  onSync,
  onDisconnect,
}: ComposioToolkitRowProps) {
  const { catalog, orgToolkit, userConnection } = row;
  const orgEnabled = orgToolkit?.status === "enabled";
  const userStatus = userConnection?.status;
  const lastError = userConnection?.lastError ?? orgToolkit?.lastError ?? null;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <ComposioToolkitLogo logoUrl={catalog.logoUrl} name={catalog.name} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p
            className="truncate font-medium text-foreground text-sm"
            title={catalog.description ?? catalog.name}
          >
            {catalog.name}
          </p>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            {catalog.slug}
          </span>
        </div>
        <ComposioToolkitRowStatus
          lastError={lastError}
          orgEnabled={orgEnabled}
          userStatus={userStatus}
        />
      </div>

      <ComposioToolkitRowActions
        assignedProfileIds={assignedProfileIds}
        busy={busy}
        catalogName={catalog.name}
        catalogSlug={catalog.slug}
        isOrgAdmin={isOrgAdmin}
        onConnect={onConnect}
        onDisable={onDisable}
        onDisconnect={onDisconnect}
        onEnable={onEnable}
        onSync={onSync}
        onToggleProfile={onToggleProfile}
        orgEnabled={orgEnabled}
        orgToolkitId={orgToolkit?.id}
        profiles={profiles}
        userStatus={userStatus}
      />
    </div>
  );
}

export interface ComposioToolkitListProps {
  assignedProfileIdsByToolkit: Map<string, string[]>;
  busy: boolean;
  data: ListComposioToolkitsResponse;
  isOrgAdmin: boolean;
  onConnect: (slug: string) => void;
  onDisable: (slug: string) => void;
  onDisconnect: (slug: string) => void;
  onEnable: (slug: string) => void;
  onSync: (slug: string) => void;
  onToggleProfile: (
    profileId: string,
    toolkitId: string,
    assigned: boolean
  ) => void;
  profiles: ProfileSummary[];
}

type ToolkitRowHandlers = Omit<
  ComposioToolkitListProps,
  "assignedProfileIdsByToolkit" | "data"
>;

export function ComposioToolkitRowList({
  assignedProfileIdsByToolkit,
  handlers,
  rows,
}: {
  assignedProfileIdsByToolkit: Map<string, string[]>;
  handlers: ToolkitRowHandlers;
  rows: ToolkitRowModel[];
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((row) => (
        <ComposioToolkitRow
          {...handlers}
          assignedProfileIds={
            assignedProfileIdsByToolkit.get(row.orgToolkit?.id ?? "") ?? []
          }
          key={row.catalog.slug}
          row={row}
        />
      ))}
    </div>
  );
}

export function ComposioToolkitTile({
  busy,
  catalog,
  onEnable,
}: {
  busy: boolean;
  catalog: ComposioCatalogToolkitSummary;
  onEnable: (slug: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card py-2.5 pr-2.5 pl-3">
      <ComposioToolkitLogo logoUrl={catalog.logoUrl} name={catalog.name} />
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-medium text-foreground text-sm"
          title={catalog.description ?? catalog.name}
        >
          {catalog.name}
        </p>
        <p className="truncate font-mono text-2xs text-muted-foreground">
          {catalog.slug}
        </p>
      </div>
      <Button
        disabled={busy}
        onClick={() => onEnable(catalog.slug)}
        size="sm"
        type="button"
        variant="outline"
      >
        Enable
      </Button>
    </div>
  );
}
