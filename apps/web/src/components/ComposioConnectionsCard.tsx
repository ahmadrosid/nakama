import type {
  ComposioCatalogToolkitSummary,
  ComposioToolkitSummary,
  ComposioUserConnectionStatus,
  ComposioUserConnectionSummary,
  ListComposioToolkitsResponse,
  ProfileSummary,
  UpdateProfileComposioToolkitsRequest,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
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
import { cn } from "@nakama/ui/utils";
import { useQueries } from "@tanstack/react-query";
import { MoreHorizontalIcon, Search01Icon } from "hugeicons-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ComposioProfileAssignPicker } from "@/components/ComposioProfileAssignPicker";
import { ComposioToolkitLogo } from "@/components/ComposioToolkitLogo";
import { IntegrationCardShell } from "@/components/integration-settings.shared";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  profileComposioToolkitsQueryOptions,
  useComposioSettings,
  useComposioToolkits,
  useConnectComposioToolkit,
  useDisableComposioToolkit,
  useDisconnectComposioToolkit,
  useEnableComposioToolkit,
  useSyncComposioToolkit,
  useUpdateProfileComposioToolkitsMutation,
} from "@/hooks/use-composio";
import { formatError } from "@/lib/client";

const EMPTY_PROFILES: ProfileSummary[] = [];

/**
 * The catalog is 200 apps, which buries the ones a team actually asks for. The
 * list opens on these plus whatever the org already enabled; everything else is
 * one click away behind "all apps", and search always covers the full catalog.
 */
const FEATURED_TOOLKIT_SLUGS = new Set([
  "airtable",
  "asana",
  "clickup",
  "discord",
  "dropbox",
  "facebook",
  "github",
  "gmail",
  "googlecalendar",
  "googledocs",
  "googledrive",
  "googlemeet",
  "googlesheets",
  "googletasks",
  "jira",
  "linear",
  "linkedin",
  "notion",
  "one_drive",
  "outlook",
  "reddit",
  "slack",
  "trello",
  "twitter",
  "whatsapp",
  "youtube",
  "zoom",
]);

function compareToolkitRows(a: ToolkitRowModel, b: ToolkitRowModel): number {
  const aActive = isActiveToolkit(a) ? 0 : 1;
  const bActive = isActiveToolkit(b) ? 0 : 1;

  if (aActive !== bActive) {
    return aActive - bActive;
  }

  return a.catalog.name.localeCompare(b.catalog.name);
}

interface ToolkitRowModel {
  catalog: ComposioCatalogToolkitSummary;
  orgToolkit: ComposioToolkitSummary | undefined;
  userConnection: ComposioUserConnectionSummary | undefined;
}

function matchesToolkitSearch(
  toolkit: ComposioCatalogToolkitSummary,
  query: string
): boolean {
  const haystack =
    `${toolkit.name} ${toolkit.slug} ${toolkit.description ?? ""}`.toLowerCase();

  return haystack.includes(query);
}

function isActiveToolkit(row: ToolkitRowModel): boolean {
  if (row.orgToolkit?.status === "enabled") {
    return true;
  }

  return row.userConnection !== undefined;
}

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

interface ComposioToolkitListProps {
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

function buildToolkitRows(
  data: ListComposioToolkitsResponse
): ToolkitRowModel[] {
  const orgBySlug = new Map(
    data.orgToolkits.map((toolkit) => [toolkit.toolkitSlug, toolkit])
  );

  const userByToolkitId = new Map(
    data.userConnections.map((connection) => [connection.toolkitId, connection])
  );

  return data.catalog.map((catalogToolkit) => {
    const orgToolkit = orgBySlug.get(catalogToolkit.slug);

    const userConnection = orgToolkit
      ? userByToolkitId.get(orgToolkit.id)
      : undefined;

    return { catalog: catalogToolkit, orgToolkit, userConnection };
  });
}

function searchToolkitRows(input: {
  isOrgAdmin: boolean;
  query: string;
  rows: ToolkitRowModel[];
}): ToolkitRowModel[] {
  const matches = input.rows.filter((row) =>
    matchesToolkitSearch(row.catalog, input.query)
  );

  if (input.isOrgAdmin) {
    return matches.toSorted(compareToolkitRows);
  }

  return matches.filter((row) => row.orgToolkit?.status === "enabled");
}

function isOrgEnabled(row: ToolkitRowModel): boolean {
  return row.orgToolkit?.status === "enabled";
}

function inUseToolkitRows(rows: ToolkitRowModel[]): ToolkitRowModel[] {
  return rows.filter(isOrgEnabled).toSorted(compareToolkitRows);
}

function addableToolkitRows(
  rows: ToolkitRowModel[],
  showAllApps: boolean
): ToolkitRowModel[] {
  return rows
    .filter(
      (row) =>
        !isOrgEnabled(row) &&
        (showAllApps || FEATURED_TOOLKIT_SLUGS.has(row.catalog.slug))
    )
    .toSorted((a, b) => a.catalog.name.localeCompare(b.catalog.name));
}

function ComposioToolkitRowList({
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

function ComposioToolkitTile({
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

function ComposioToolkitList({
  assignedProfileIdsByToolkit,
  data,
  ...handlers
}: ComposioToolkitListProps) {
  const { busy, isOrgAdmin, onEnable } = handlers;
  const [search, setSearch] = useState("");
  const [showAllApps, setShowAllApps] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const query = deferredSearch.trim().toLowerCase();
  const isSearching = query.length > 0;

  const rows = useMemo(() => buildToolkitRows(data), [data]);

  const enabledCount = rows.filter(
    (row) => row.orgToolkit?.status === "enabled"
  ).length;

  const connectedCount = rows.filter(
    (row) => row.userConnection?.status === "connected"
  ).length;

  const searchRows = useMemo(
    () => (isSearching ? searchToolkitRows({ isOrgAdmin, query, rows }) : []),
    [isOrgAdmin, isSearching, query, rows]
  );

  const inUseRows = useMemo(() => inUseToolkitRows(rows), [rows]);

  const addRows = useMemo(
    () => (isOrgAdmin ? addableToolkitRows(rows, showAllApps) : []),
    [rows, isOrgAdmin, showAllApps]
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-medium text-xl">Connectors</h1>
        <div className="relative min-w-56 flex-[0_1_20rem]">
          <Search01Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search apps"
            className="h-10 pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              isOrgAdmin
                ? `Search ${data.catalog.length} apps`
                : "Search enabled apps"
            }
            type="search"
            value={search}
          />
        </div>
      </header>

      {isSearching ? (
        <section className="space-y-3">
          <h2 className="font-medium text-sm tabular-nums">
            {searchRows.length} match{searchRows.length === 1 ? "" : "es"}
          </h2>
          {searchRows.length > 0 ? (
            <ComposioToolkitRowList
              assignedProfileIdsByToolkit={assignedProfileIdsByToolkit}
              handlers={handlers}
              rows={searchRows}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              No apps match &ldquo;{search.trim()}&rdquo;.
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="font-medium text-sm">In use</h2>
              <p className="text-muted-foreground text-sm tabular-nums">
                {enabledCount} enabled · {connectedCount} connected by you
              </p>
            </div>
            {inUseRows.length > 0 ? (
              <ComposioToolkitRowList
                assignedProfileIdsByToolkit={assignedProfileIdsByToolkit}
                handlers={handlers}
                rows={inUseRows}
              />
            ) : (
              <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
                {isOrgAdmin
                  ? "No apps enabled yet."
                  : "No apps are enabled for your org yet. Ask an org admin to enable one."}
              </p>
            )}
          </section>

          {isOrgAdmin ? (
            <ComposioAddSection
              addRows={addRows}
              busy={busy}
              catalogSize={data.catalog.length}
              onEnable={onEnable}
              onToggleShowAll={() => setShowAllApps((current) => !current)}
              showAllApps={showAllApps}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function ComposioAddSection({
  addRows,
  busy,
  catalogSize,
  onEnable,
  onToggleShowAll,
  showAllApps,
}: {
  addRows: ToolkitRowModel[];
  busy: ComposioToolkitListProps["busy"];
  catalogSize: number;
  onEnable: ComposioToolkitListProps["onEnable"];
  onToggleShowAll: () => void;
  showAllApps: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">Add an app</h2>
        <Button
          className="h-auto p-0"
          onClick={() => onToggleShowAll()}
          type="button"
          variant="link"
        >
          {showAllApps ? "Show popular apps" : `Show all ${catalogSize} apps`}
        </Button>
      </div>
      {catalogSize === 0 ? (
        <p className="text-muted-foreground text-sm">
          No toolkits available yet.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5">
          {addRows.map((row) => (
            <ComposioToolkitTile
              busy={busy}
              catalog={row.catalog}
              key={row.catalog.slug}
              onEnable={onEnable}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ComposioConnectionsSkeleton({
  bordered = false,
}: {
  bordered?: boolean;
}) {
  return (
    <IntegrationCardShell
      bordered={bordered}
      busyLabel="Loading Composio toolkits"
    >
      <div className="space-y-3 border-border border-b px-4 py-3">
        <div className="space-y-2">
          <div className="skeleton-shimmer h-4 w-28 rounded" />
          <div className="skeleton-shimmer h-3 w-full max-w-sm rounded" />
        </div>
        <div className="skeleton-shimmer h-9 w-full rounded-md" />
        <div className="skeleton-shimmer h-3 w-48 rounded" />
      </div>

      <div className="divide-y divide-border">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="flex items-center gap-3 px-4 py-2.5" key={index}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="skeleton-shimmer h-4 w-24 rounded" />
                <div className="skeleton-shimmer h-3 w-16 rounded" />
              </div>
              <div className="flex gap-1.5">
                <div className="skeleton-shimmer h-5 w-24 rounded-full" />
                <div className="skeleton-shimmer h-5 w-20 rounded-full" />
              </div>
            </div>
            <div className="skeleton-shimmer h-8 w-20 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </IntegrationCardShell>
  );
}

function nextProfileToolkitAssignments(
  current: NonNullable<UpdateProfileComposioToolkitsRequest["assignments"]>,
  toolkitId: string,
  assigned: boolean
): UpdateProfileComposioToolkitsRequest["assignments"] {
  const next: UpdateProfileComposioToolkitsRequest["assignments"] = [];

  for (const entry of current) {
    if (!assigned && entry.toolkitId === toolkitId) {
      continue;
    }

    next.push({
      allowedActions: entry.allowedActions,
      toolkitId: entry.toolkitId,
    });
  }

  if (assigned) {
    next.push({ allowedActions: null, toolkitId });
  }

  return next;
}

function useComposioConnectionsState() {
  const { activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const { data: settings } = useComposioSettings();
  const toolkitsQuery = useComposioToolkits();
  const connectMutation = useConnectComposioToolkit();
  const enableMutation = useEnableComposioToolkit();
  const assignMutation = useUpdateProfileComposioToolkitsMutation();
  const profilesQuery = useProfilesQuery();

  const profiles = isOrgAdmin
    ? (profilesQuery.data ?? EMPTY_PROFILES)
    : EMPTY_PROFILES;

  const assignmentQueries = useQueries({
    queries: profiles.map((profile) =>
      profileComposioToolkitsQueryOptions(profile.id)
    ),
  });

  const assignedProfileIdsByToolkit = useMemo(() => {
    const map = new Map<string, string[]>();

    profiles.forEach((profile, index) => {
      for (const assignment of assignmentQueries[index]?.data?.assignments ??
        []) {
        map.set(assignment.toolkitId, [
          ...(map.get(assignment.toolkitId) ?? []),
          profile.id,
        ]);
      }
    });

    return map;
  }, [profiles, assignmentQueries]);

  const toggleProfileAssignment = (
    profileId: string,
    toolkitId: string,
    assigned: boolean
  ) => {
    const index = profiles.findIndex((profile) => profile.id === profileId);
    const current = assignmentQueries[index]?.data?.assignments ?? [];
    assignMutation.mutate({
      assignments: nextProfileToolkitAssignments(current, toolkitId, assigned),
      profileId,
    });
  };

  const disableMutation = useDisableComposioToolkit();
  const disconnectMutation = useDisconnectComposioToolkit();
  const syncMutation = useSyncComposioToolkit();

  const busy =
    assignMutation.isPending ||
    connectMutation.isPending ||
    enableMutation.isPending ||
    disableMutation.isPending ||
    disconnectMutation.isPending ||
    syncMutation.isPending;

  return {
    assignedProfileIdsByToolkit,
    busy,
    connectMutation,
    disableMutation,
    disconnectMutation,
    enableMutation,
    isOrgAdmin,
    profiles,
    settings,
    syncMutation,
    toggleProfileAssignment,
    toolkitsQuery,
  };
}

function ComposioNotConfiguredState({
  bordered,
  embedded,
  isOrgAdmin,
}: {
  bordered: boolean;
  embedded: boolean;
  isOrgAdmin: boolean;
}) {
  return (
    <IntegrationCardShell bordered={bordered} embedded={embedded}>
      <div className="space-y-2 p-4 text-muted-foreground text-sm">
        <p className="font-medium text-foreground">
          {isOrgAdmin
            ? "Save your Composio API key first"
            : "Composio is not configured on this server"}
        </p>
        {isOrgAdmin ? (
          <p>
            Save it in{" "}
            <Link
              className="text-foreground underline underline-offset-3"
              to="/settings#composio"
            >
              Settings
            </Link>
            , then enable toolkits here.
          </p>
        ) : (
          <p>Ask a platform admin to save the Composio API key.</p>
        )}
      </div>
    </IntegrationCardShell>
  );
}

function ComposioCatalogErrorState({
  bordered,
  catalogError,
  embedded,
  isOrgAdmin,
}: {
  bordered: boolean;
  catalogError: string;
  embedded: boolean;
  isOrgAdmin: boolean;
}) {
  return (
    <IntegrationCardShell bordered={bordered} embedded={embedded}>
      <div className="space-y-2 p-4 text-sm">
        <p className="font-medium text-foreground">
          Could not load Composio toolkits
        </p>
        <p className="text-destructive">{catalogError}</p>
        {isOrgAdmin ? (
          <p className="text-muted-foreground">
            Check the project API key in Composio, then save it again in
            Settings.
          </p>
        ) : null}
      </div>
    </IntegrationCardShell>
  );
}

function ComposioConnectionsReady({
  bordered,
  embedded,
  state,
}: {
  bordered: boolean;
  embedded: boolean;
  state: ReturnType<typeof useComposioConnectionsState>;
}) {
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);

  const [connectError, setConnectError] = useState<{
    slug: string;
    message: string;
  } | null>(null);

  const needsCustomAuthConfig = connectError?.message.includes(
    "Auth_Config_DefaultAuthConfigNotFound"
  );

  const data = state.toolkitsQuery.data;

  const toolkitName =
    data?.catalog.find((item) => item.slug === connectError?.slug)?.name ??
    connectError?.slug;

  const configured =
    state.settings?.configured === true || data?.configured === true;

  if (!configured) {
    return (
      <ComposioNotConfiguredState
        bordered={bordered}
        embedded={embedded}
        isOrgAdmin={state.isOrgAdmin}
      />
    );
  }

  if (!data) {
    return null;
  }

  if (data.catalogError) {
    return (
      <ComposioCatalogErrorState
        bordered={bordered}
        catalogError={data.catalogError}
        embedded={embedded}
        isOrgAdmin={state.isOrgAdmin}
      />
    );
  }

  return (
    <>
      <ComposioToolkitList
        assignedProfileIdsByToolkit={state.assignedProfileIdsByToolkit}
        busy={state.busy}
        data={data}
        isOrgAdmin={state.isOrgAdmin}
        onConnect={(slug) =>
          state.connectMutation.mutate(slug, {
            onError: (error) =>
              setConnectError({ message: formatError(error), slug }),
          })
        }
        onDisable={(slug) => state.disableMutation.mutate(slug)}
        onDisconnect={setDisconnectTarget}
        onEnable={(slug) => state.enableMutation.mutate(slug)}
        onSync={(slug) => state.syncMutation.mutate(slug)}
        onToggleProfile={state.toggleProfileAssignment}
        profiles={state.profiles}
      />
      {disconnectTarget ? (
        <ConfirmDialog
          confirmLabel="Disconnect"
          description={`Disconnect ${disconnectTarget}? You will need to reconnect to use this account again.`}
          onClose={() => setDisconnectTarget(null)}
          onConfirm={() =>
            state.disconnectMutation.mutateAsync(disconnectTarget)
          }
          title="Disconnect toolkit?"
        />
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setConnectError(null);
          }
        }}
        open={connectError !== null}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {needsCustomAuthConfig
                ? `${toolkitName} needs a custom auth config`
                : "Could not connect toolkit"}
            </DialogTitle>
          </DialogHeader>
          {needsCustomAuthConfig ? (
            <>
              <DialogDescription>
                Composio has no managed credentials for {toolkitName}.
              </DialogDescription>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>Open the Composio project for this API key.</li>
                <li>
                  Create a custom auth config for {toolkitName}. Enter the
                  credentials that Composio requests.
                </li>
                <li>Return here and try Connect again.</li>
              </ol>
              <a
                className="text-sm underline underline-offset-3"
                href="https://next.docs.composio.dev/docs/auth-configuration/custom-auth-configs"
                rel="noreferrer"
                target="_blank"
              >
                View setup guide
              </a>
            </>
          ) : (
            <DialogDescription>{connectError?.message}</DialogDescription>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ComposioConnectionsCard({
  embedded = false,
  bordered = false,
}: {
  embedded?: boolean;
  bordered?: boolean;
}) {
  const state = useComposioConnectionsState();

  if (state.toolkitsQuery.isLoading) {
    return <ComposioConnectionsSkeleton bordered={bordered} />;
  }

  if (state.toolkitsQuery.error) {
    return (
      <IntegrationCardShell bordered={bordered} embedded={embedded}>
        <div className="p-4 text-destructive text-sm">
          {formatError(state.toolkitsQuery.error)}
        </div>
      </IntegrationCardShell>
    );
  }

  return (
    <ComposioConnectionsReady
      bordered={bordered}
      embedded={embedded}
      state={state}
    />
  );
}
