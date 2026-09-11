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

const CATALOG_PAGE_SIZE = 15;
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

function StatusPill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "success" | "warning" | "error" | "muted";
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 font-medium text-2xs",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
        tone === "error" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200",
        tone === "muted" && "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

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
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <StatusPill
          label={orgEnabled ? "Enabled for org" : "Not enabled"}
          tone={orgEnabled ? "success" : "muted"}
        />
        {orgEnabled ? (
          <StatusPill
            label={userConnectionLabel(userStatus)}
            tone={userConnectionTone(userStatus)}
          />
        ) : null}
      </div>
      {orgEnabled && userStatus === "connected" ? (
        <p className="mt-1 text-muted-foreground text-xs">
          Assigned to the default profile when it was enabled.
        </p>
      ) : null}
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
    <div className="flex items-center gap-3 px-4 py-2.5">
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

function filterToolkitRows(input: {
  isOrgAdmin: boolean;
  isSearching: boolean;
  query: string;
  rows: ToolkitRowModel[];
  showAllApps: boolean;
}): ToolkitRowModel[] {
  const { isOrgAdmin, isSearching, query, rows, showAllApps } = input;
  const activeRows = rows.filter(isActiveToolkit);

  if (isSearching) {
    const matches = rows.filter((row) =>
      matchesToolkitSearch(row.catalog, query)
    );
    if (isOrgAdmin) {
      return matches.toSorted(compareToolkitRows);
    }

    return matches.filter((row) => row.orgToolkit?.status === "enabled");
  }

  if (!isOrgAdmin) {
    return activeRows.filter((row) => row.orgToolkit?.status === "enabled");
  }

  if (showAllApps) {
    return rows.toSorted(compareToolkitRows);
  }

  return rows
    .filter(
      (row) =>
        FEATURED_TOOLKIT_SLUGS.has(row.catalog.slug) || isActiveToolkit(row)
    )
    .toSorted(compareToolkitRows);
}

function toolkitListSummary(input: {
  catalogLength: number;
  connectedCount: number;
  enabledCount: number;
  filteredCount: number;
  isOrgAdmin: boolean;
  isSearching: boolean;
  showAllApps: boolean;
}): string {
  if (input.isSearching) {
    return `${input.filteredCount} match${input.filteredCount === 1 ? "" : "es"}`;
  }

  if (input.isOrgAdmin) {
    const shown = input.showAllApps ? input.catalogLength : input.filteredCount;
    return `${input.enabledCount} enabled · ${input.connectedCount} connected by you · ${shown} shown`;
  }

  return `${input.enabledCount} enabled · ${input.connectedCount} connected by you`;
}

function ComposioToolkitListToolbar({
  catalogLength,
  connectedCount,
  enabledCount,
  filteredCount,
  isOrgAdmin,
  isSearching,
  onSearchChange,
  onToggleShowAllApps,
  search,
  showAllApps,
}: {
  catalogLength: number;
  connectedCount: number;
  enabledCount: number;
  filteredCount: number;
  isOrgAdmin: boolean;
  isSearching: boolean;
  onSearchChange: (value: string) => void;
  onToggleShowAllApps: () => void;
  search: string;
  showAllApps: boolean;
}) {
  return (
    <div className="space-y-3 border-border border-b px-4 py-3">
      <div>
        <p className="font-medium text-foreground text-sm">SaaS toolkits</p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {isOrgAdmin
            ? "Enable an app for your org. Members connect their own accounts from chat when they need a toolkit."
            : "Ask your agent in chat to connect org-enabled apps. Chat uses your credentials, not a shared org login."}
        </p>
      </div>

      <div className="relative">
        <Search01Icon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="h-9 border-border/60 bg-muted/20 pl-8 text-sm shadow-none"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={
            isOrgAdmin
              ? "Search apps to enable (Gmail, Slack, GitHub…)"
              : "Search enabled apps…"
          }
          value={search}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs tabular-nums">
          {toolkitListSummary({
            catalogLength,
            connectedCount,
            enabledCount,
            filteredCount,
            isOrgAdmin,
            isSearching,
            showAllApps,
          })}
        </p>

        {isOrgAdmin && !isSearching ? (
          <Button
            className="h-auto p-0 text-xs"
            onClick={onToggleShowAllApps}
            type="button"
            variant="link"
          >
            {showAllApps
              ? "Show popular apps"
              : `Show all ${catalogLength} apps`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ComposioToolkitListResults({
  assignedProfileIdsByToolkit,
  busy,
  catalogLength,
  displayedRows,
  isOrgAdmin,
  isSearching,
  onConnect,
  onDisable,
  onDisconnect,
  onEnable,
  onShowMore,
  onSync,
  onToggleProfile,
  profiles,
  remainingCount,
  search,
}: {
  assignedProfileIdsByToolkit: Map<string, string[]>;
  busy: boolean;
  catalogLength: number;
  displayedRows: ToolkitRowModel[];
  isOrgAdmin: boolean;
  isSearching: boolean;
  onConnect: (slug: string) => void;
  onDisable: (slug: string) => void;
  onDisconnect: (slug: string) => void;
  onEnable: (slug: string) => void;
  onShowMore: () => void;
  onSync: (slug: string) => void;
  onToggleProfile: (
    profileId: string,
    toolkitId: string,
    assigned: boolean
  ) => void;
  profiles: ProfileSummary[];
  remainingCount: number;
  search: string;
}) {
  if (catalogLength === 0) {
    return (
      <div className="px-4 py-6 text-muted-foreground text-sm">
        No toolkits available yet.
      </div>
    );
  }

  if (displayedRows.length === 0) {
    if (isSearching) {
      return (
        <div className="space-y-1 px-4 py-8 text-center text-muted-foreground text-sm">
          <p>No apps match &ldquo;{search.trim()}&rdquo;.</p>
          <p className="text-xs">Try another name or slug.</p>
        </div>
      );
    }

    return (
      <div className="space-y-1 px-4 py-8 text-center text-muted-foreground text-sm">
        <p>No apps are enabled for your org yet.</p>
        <p className="text-xs">Ask an org admin to enable toolkits first.</p>
      </div>
    );
  }

  return (
    <>
      <div className="max-h-[min(28rem,60vh)] overflow-y-auto">
        <div className="divide-y divide-border">
          {displayedRows.map((row) => (
            <ComposioToolkitRow
              assignedProfileIds={
                assignedProfileIdsByToolkit.get(row.orgToolkit?.id ?? "") ?? []
              }
              busy={busy}
              isOrgAdmin={isOrgAdmin}
              key={row.catalog.slug}
              onConnect={onConnect}
              onDisable={onDisable}
              onDisconnect={onDisconnect}
              onEnable={onEnable}
              onSync={onSync}
              onToggleProfile={onToggleProfile}
              profiles={profiles}
              row={row}
            />
          ))}
        </div>
      </div>

      {remainingCount > 0 ? (
        <div className="border-border border-t px-4 py-3 text-center">
          <Button
            onClick={onShowMore}
            size="sm"
            type="button"
            variant="outline"
          >
            Show more (<span className="tabular-nums">{remainingCount}</span>{" "}
            remaining)
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ComposioToolkitList({
  data,
  isOrgAdmin,
  busy,
  assignedProfileIdsByToolkit,
  profiles,
  onToggleProfile,
  onConnect,
  onEnable,
  onDisable,
  onSync,
  onDisconnect,
}: ComposioToolkitListProps) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [showAllApps, setShowAllApps] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const query = deferredSearch.trim().toLowerCase();
  const isSearching = query.length > 0;

  const rows = useMemo(() => buildToolkitRows(data), [data]);
  const enabledCount = useMemo(
    () => rows.filter((row) => row.orgToolkit?.status === "enabled").length,
    [rows]
  );
  const connectedCount = useMemo(
    () =>
      rows.filter((row) => row.userConnection?.status === "connected").length,
    [rows]
  );
  const filteredRows = useMemo(
    () =>
      filterToolkitRows({
        isOrgAdmin,
        isSearching,
        query,
        rows,
        showAllApps,
      }),
    [isOrgAdmin, isSearching, query, rows, showAllApps]
  );

  const displayedRows = filteredRows.slice(0, visibleCount);
  const remainingCount = Math.max(
    filteredRows.length - displayedRows.length,
    0
  );

  return (
    <>
      <ComposioToolkitListToolbar
        catalogLength={data.catalog.length}
        connectedCount={connectedCount}
        enabledCount={enabledCount}
        filteredCount={filteredRows.length}
        isOrgAdmin={isOrgAdmin}
        isSearching={isSearching}
        onSearchChange={(value) => {
          setSearch(value);
          setVisibleCount(CATALOG_PAGE_SIZE);
        }}
        onToggleShowAllApps={() => {
          setShowAllApps((current) => !current);
          setVisibleCount(CATALOG_PAGE_SIZE);
        }}
        search={search}
        showAllApps={showAllApps}
      />
      <ComposioToolkitListResults
        assignedProfileIdsByToolkit={assignedProfileIdsByToolkit}
        busy={busy}
        catalogLength={data.catalog.length}
        displayedRows={displayedRows}
        isOrgAdmin={isOrgAdmin}
        isSearching={isSearching}
        onConnect={onConnect}
        onDisable={onDisable}
        onDisconnect={onDisconnect}
        onEnable={onEnable}
        onShowMore={() =>
          setVisibleCount((current) => current + CATALOG_PAGE_SIZE)
        }
        onSync={onSync}
        onToggleProfile={onToggleProfile}
        profiles={profiles}
        remainingCount={remainingCount}
        search={search}
      />
    </>
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
        <p>
          {isOrgAdmin
            ? "Once the key is saved above, you can enable toolkits here. Members connect from chat."
            : "Ask an org admin to save the Composio project API key on Integrations."}
        </p>
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
            Verify the saved project API key under Settings → Project Settings →
            API Keys, then save it again above.
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
  const data = state.toolkitsQuery.data;
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
    <IntegrationCardShell bordered={bordered} embedded={embedded}>
      <ComposioToolkitList
        assignedProfileIdsByToolkit={state.assignedProfileIdsByToolkit}
        busy={state.busy}
        data={data}
        isOrgAdmin={state.isOrgAdmin}
        onConnect={(slug) => state.connectMutation.mutate(slug)}
        onDisable={(slug) => state.disableMutation.mutate(slug)}
        onDisconnect={(slug) => state.disconnectMutation.mutate(slug)}
        onEnable={(slug) => state.enableMutation.mutate(slug)}
        onSync={(slug) => state.syncMutation.mutate(slug)}
        onToggleProfile={state.toggleProfileAssignment}
        profiles={state.profiles}
      />
    </IntegrationCardShell>
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
