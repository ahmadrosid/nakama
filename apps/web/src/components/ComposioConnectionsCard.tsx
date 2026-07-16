import type {
  ComposioCatalogToolkitSummary,
  ComposioToolkitSummary,
  ComposioUserConnectionStatus,
  ComposioUserConnectionSummary,
  ListComposioToolkitsResponse,
} from "@nakama/core/contract";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { ComposioToolkitLogo } from "@/components/ComposioToolkitLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/use-auth";
import {
  useComposioSettings,
  useComposioToolkits,
  useDisableComposioToolkit,
  useDisconnectComposioToolkit,
  useEnableComposioToolkit,
  useSyncComposioToolkit,
} from "@/hooks/use-composio";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

const CATALOG_PAGE_SIZE = 15;

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

function matchesToolkitSearch(toolkit: ComposioCatalogToolkitSummary, query: string): boolean {
  const haystack = `${toolkit.name} ${toolkit.slug} ${toolkit.description ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

function isActiveToolkit(row: ToolkitRowModel): boolean {
  if (row.orgToolkit?.status === "enabled") {
    return true;
  }

  return row.userConnection !== undefined;
}

function userConnectionLabel(status: ComposioUserConnectionStatus | undefined): string {
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
  status: ComposioUserConnectionStatus | undefined,
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
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
        tone === "error" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200",
        tone === "muted" && "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

interface ComposioToolkitRowProps {
  row: ToolkitRowModel;
  isOrgAdmin: boolean;
  busy: boolean;
  onEnable: (slug: string) => void;
  onDisable: (slug: string) => void;
  onSync: (slug: string) => void;
  onDisconnect: (slug: string) => void;
}

function ComposioToolkitRow({
  row,
  isOrgAdmin,
  busy,
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
      <ComposioToolkitLogo name={catalog.name} logoUrl={catalog.logoUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p
            className="truncate text-sm font-medium text-foreground"
            title={catalog.description ?? catalog.name}
          >
            {catalog.name}
          </p>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{catalog.slug}</span>
        </div>
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
        {lastError ? <p className="mt-1 truncate text-xs text-destructive">{lastError}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isOrgAdmin && !orgEnabled ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => onEnable(catalog.slug)}>
            Enable
          </Button>
        ) : null}

        {orgEnabled && userStatus === "connected" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" size="icon-sm" variant="outline" disabled={busy} aria-label="Toolkit actions" />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSync(catalog.slug)}>Sync tools</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDisconnect(catalog.slug)}>Disconnect</DropdownMenuItem>
              {isOrgAdmin ? (
                <DropdownMenuItem onClick={() => onDisable(catalog.slug)}>Disable for org</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {isOrgAdmin && orgEnabled && userStatus !== "connected" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDisable(catalog.slug)}
          >
            Disable
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface ComposioToolkitListProps {
  data: ListComposioToolkitsResponse;
  isOrgAdmin: boolean;
  busy: boolean;
  onEnable: (slug: string) => void;
  onDisable: (slug: string) => void;
  onSync: (slug: string) => void;
  onDisconnect: (slug: string) => void;
}

function ComposioToolkitList({
  data,
  isOrgAdmin,
  busy,
  onEnable,
  onDisable,
  onSync,
  onDisconnect,
}: ComposioToolkitListProps) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);

  const query = deferredSearch.trim().toLowerCase();
  const isSearching = query.length > 0;

  const rows = useMemo(() => {
    const orgBySlug = new Map(data.orgToolkits.map((toolkit) => [toolkit.toolkitSlug, toolkit]));
    const userByToolkitId = new Map(
      data.userConnections.map((connection) => [connection.toolkitId, connection]),
    );

    return data.catalog.map((catalogToolkit) => {
      const orgToolkit = orgBySlug.get(catalogToolkit.slug);
      const userConnection = orgToolkit ? userByToolkitId.get(orgToolkit.id) : undefined;

      return { catalog: catalogToolkit, orgToolkit, userConnection };
    });
  }, [data.catalog, data.orgToolkits, data.userConnections]);

  const activeRows = useMemo(() => rows.filter(isActiveToolkit), [rows]);
  const enabledCount = useMemo(
    () => rows.filter((row) => row.orgToolkit?.status === "enabled").length,
    [rows],
  );
  const connectedCount = useMemo(
    () => rows.filter((row) => row.userConnection?.status === "connected").length,
    [rows],
  );

  const filteredRows = useMemo(() => {
    if (isSearching) {
      const matches = rows.filter((row) => matchesToolkitSearch(row.catalog, query));
      return isOrgAdmin
        ? matches.toSorted(compareToolkitRows)
        : matches.filter((row) => row.orgToolkit?.status === "enabled");
    }

    if (!isOrgAdmin) {
      return activeRows.filter((row) => row.orgToolkit?.status === "enabled");
    }

    return rows.toSorted(compareToolkitRows);
  }, [activeRows, isOrgAdmin, isSearching, query, rows]);

  const displayedRows = filteredRows.slice(0, visibleCount);
  const remainingCount = Math.max(filteredRows.length - displayedRows.length, 0);

  return (
    <>
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">SaaS toolkits</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isOrgAdmin
              ? "Enable an app for your org. Members connect their own accounts from chat when they need a toolkit."
              : "Ask your agent in chat to connect org-enabled apps. Chat uses your credentials, not a shared org login."}
          </p>
        </div>

        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisibleCount(CATALOG_PAGE_SIZE);
            }}
            placeholder={
              isOrgAdmin ? "Search apps to enable (Gmail, Slack, GitHub…)" : "Search enabled apps…"
            }
            className="h-9 border-border/60 bg-muted/20 pl-8 text-sm shadow-none"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {isSearching
            ? `${filteredRows.length} match${filteredRows.length === 1 ? "" : "es"}`
            : isOrgAdmin
              ? `${enabledCount} enabled · ${connectedCount} connected by you · ${data.catalog.length} available`
              : `${enabledCount} enabled · ${connectedCount} connected by you`}
        </p>
      </div>

      {data.catalog.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">No toolkits available yet.</div>
      ) : filteredRows.length === 0 ? (
        <div className="space-y-1 px-4 py-8 text-center text-sm text-muted-foreground">
          {isSearching ? (
            <>
              <p>No apps match &ldquo;{search.trim()}&rdquo;.</p>
              <p className="text-xs">Try another name or slug.</p>
            </>
          ) : (
            <>
              <p>No apps are enabled for your org yet.</p>
              <p className="text-xs">Ask an org admin to enable toolkits first.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto">
            <div className="divide-y divide-border">
              {displayedRows.map((row) => (
                <ComposioToolkitRow
                  key={row.catalog.slug}
                  row={row}
                  isOrgAdmin={isOrgAdmin}
                  busy={busy}
                  onEnable={onEnable}
                  onDisable={onDisable}
                  onSync={onSync}
                  onDisconnect={onDisconnect}
                />
              ))}
            </div>
          </div>

          {remainingCount > 0 ? (
            <div className="border-t border-border px-4 py-3 text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((current) => current + CATALOG_PAGE_SIZE)}
              >
                Show more ({remainingCount} remaining)
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function ComposioConnectionsSkeleton() {
  return (
    <Card className="w-full shadow-none">
      <CardContent className="p-0" aria-busy="true" aria-label="Loading Composio toolkits">
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="space-y-2">
            <div className="skeleton-shimmer h-4 w-28 rounded" />
            <div className="skeleton-shimmer h-3 w-full max-w-sm rounded" />
          </div>
          <div className="skeleton-shimmer h-9 w-full rounded-md" />
          <div className="skeleton-shimmer h-3 w-48 rounded" />
        </div>

        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-2.5">
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
      </CardContent>
    </Card>
  );
}

export function ComposioConnectionsCard() {
  const { activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const { data: settings } = useComposioSettings();
  const toolkitsQuery = useComposioToolkits();
  const enableMutation = useEnableComposioToolkit();
  const disableMutation = useDisableComposioToolkit();
  const disconnectMutation = useDisconnectComposioToolkit();
  const syncMutation = useSyncComposioToolkit();

  const busy =
    enableMutation.isPending ||
    disableMutation.isPending ||
    disconnectMutation.isPending ||
    syncMutation.isPending;

  if (toolkitsQuery.isLoading) {
    return <ComposioConnectionsSkeleton />;
  }

  if (toolkitsQuery.error) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="p-4 text-sm text-destructive">
          {formatError(toolkitsQuery.error)}
        </CardContent>
      </Card>
    );
  }

  const data = toolkitsQuery.data;
  const configured = settings?.configured === true || data?.configured === true;

  if (!configured) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
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
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  if (data.catalogError) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="space-y-2 p-4 text-sm">
          <p className="font-medium text-foreground">Could not load Composio toolkits</p>
          <p className="text-destructive">{data.catalogError}</p>
          {isOrgAdmin ? (
            <p className="text-muted-foreground">
              Verify the saved project API key under Settings → Project Settings → API Keys, then
              save it again above.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="p-0">
        <ComposioToolkitList
          data={data}
          isOrgAdmin={isOrgAdmin}
          busy={busy}
          onEnable={(slug) => enableMutation.mutate(slug)}
          onDisable={(slug) => disableMutation.mutate(slug)}
          onSync={(slug) => syncMutation.mutate(slug)}
          onDisconnect={(slug) => disconnectMutation.mutate(slug)}
        />
      </CardContent>
    </Card>
  );
}
