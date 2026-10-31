import type { NakamaUpgradeResponse } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/use-auth";
import {
  useNakamaUpgradeQuery,
  useNakamaVersionQuery,
  useStartNakamaUpgrade,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

type UpgradeStatus = NakamaUpgradeResponse["status"];

function VersionStatus({
  query,
}: {
  query: ReturnType<typeof useNakamaVersionQuery>;
}) {
  if (query.error) {
    return (
      <p className="text-destructive text-xs" role="alert">
        {formatError(query.error)}
      </p>
    );
  }

  if (!query.data) {
    return null;
  }

  if (!query.data.updateAvailable) {
    return <p className="text-muted-foreground text-xs">Up to date</p>;
  }

  return (
    <p className="text-xs" role="status">
      {query.data.latest} available ·{" "}
      <a
        className="underline underline-offset-2"
        href={query.data.releaseUrl}
        rel="noreferrer"
        target="_blank"
      >
        Release notes
      </a>
    </p>
  );
}

function UpgradeAction({
  available,
  latest,
  running,
}: {
  available: boolean;
  latest: string;
  running: boolean;
}) {
  const start = useStartNakamaUpgrade();

  if (!available) {
    return (
      <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {`sed -i 's/^NAKAMA_VERSION=.*/NAKAMA_VERSION=${latest}/' .env\ndocker compose pull && docker compose up -d`}
      </pre>
    );
  }

  const busy = running || start.isPending;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={busy}
        onClick={() => start.mutate({ version: latest })}
        size="sm"
        type="button"
      >
        {busy ? <Spinner className="mr-2" /> : null}
        Update to {latest}
      </Button>
      {start.error ? (
        <p className="text-destructive text-xs" role="alert">
          {formatError(start.error)}
        </p>
      ) : null}
    </div>
  );
}

function RollbackAction({
  rollbacks,
}: {
  rollbacks: NakamaUpgradeResponse["rollbacks"];
}) {
  const start = useStartNakamaUpgrade();

  const [target, setTarget] = useState<(typeof rollbacks)[number] | null>(null);

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">Previous versions</p>
      {rollbacks.map((entry) => (
        <div className="flex items-center gap-3" key={entry.version}>
          <p className="font-mono text-sm tabular-nums">{entry.version}</p>
          <p className="text-muted-foreground text-xs">
            {new Date(entry.at).toLocaleString()}
          </p>
          <Button
            disabled={start.isPending}
            onClick={() => setTarget(entry)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Restore
          </Button>
        </div>
      ))}
      {target ? (
        <ConfirmDialog
          confirmLabel="Restore"
          description={`Nakama goes back to ${target.version} with its data from ${new Date(target.at).toLocaleString()}. The current data is archived, so you can restore it from this list.`}
          onClose={() => setTarget(null)}
          onConfirm={() =>
            start.mutateAsync({ rollback: true, version: target.version })
          }
          title={`Restore ${target.version}?`}
        />
      ) : null}
    </div>
  );
}

function UpgradeMessage({ status }: { status: UpgradeStatus }) {
  if (!status) {
    return null;
  }

  const failed = status.state === "failed" || status.state === "rolled_back";

  return (
    <div className="space-y-1">
      <p
        className={failed ? "text-destructive text-xs" : "text-xs"}
        role="status"
      >
        {status.message}
      </p>
      {status.state === "running" && status.progress ? (
        <progress
          aria-label="Download"
          className="h-1 w-40 appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
          max={status.progress.total}
          value={status.progress.done}
        />
      ) : null}
    </div>
  );
}

/** A finished upgrade restarted the server, so its version and badge are stale. */
function useRefreshAfterUpgrade(status: UpgradeStatus) {
  const queryClient = useQueryClient();
  const doneAt = status?.state === "done" ? status.at : null;

  useEffect(() => {
    if (doneAt) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      void queryClient.invalidateQueries({ queryKey: queryKeys.nakamaVersion });
    }
  }, [doneAt, queryClient]);
}

export function VersionSettingsRow({
  updateCheckEnabled,
  version,
}: {
  updateCheckEnabled: boolean;
  version: string;
}) {
  const isPlatformAdmin = useAuth().user?.isPlatformAdmin === true;
  const canCheck = updateCheckEnabled && isPlatformAdmin;
  const query = useNakamaVersionQuery(canCheck);
  const upgrade = useNakamaUpgradeQuery(canCheck);
  const status = upgrade.data?.status ?? null;
  const latest = query.data?.updateAvailable ? query.data.latest : null;

  useRefreshAfterUpgrade(status);

  return (
    <div className="space-y-3 px-4 py-3" id="version">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Version</p>
          <VersionStatus query={query} />
          <UpgradeMessage status={status} />
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-muted-foreground text-sm tabular-nums">
            {version}
          </p>
          {canCheck ? (
            <Button
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {query.isFetching ? <Spinner className="mr-2" /> : null}
              Check for updates
            </Button>
          ) : null}
        </div>
      </div>
      {upgrade.data?.available &&
      upgrade.data.rollbacks.length > 0 &&
      status?.state !== "running" ? (
        <RollbackAction rollbacks={upgrade.data.rollbacks} />
      ) : null}
      {latest ? (
        <UpgradeAction
          available={upgrade.data?.available === true}
          latest={latest}
          running={status?.state === "running"}
        />
      ) : null}
    </div>
  );
}
