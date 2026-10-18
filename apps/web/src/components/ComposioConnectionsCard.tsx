import type {
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
import { Input } from "@nakama/ui/input";
import { useQueries } from "@tanstack/react-query";
import { Search01Icon } from "hugeicons-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addableToolkitRows,
  buildToolkitRows,
  type ComposioToolkitListProps,
  ComposioToolkitRowList,
  ComposioToolkitTile,
  inUseToolkitRows,
  searchToolkitRows,
  type ToolkitRowModel,
} from "@/components/ComposioToolkitRows";
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
      <header className="flex flex-wrap items-center gap-4">
        <div className="relative min-w-56 flex-1">
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
