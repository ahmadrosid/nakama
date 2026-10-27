import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useNakamaVersionQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

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

export function VersionSettingsRow({ version }: { version: string }) {
  const isPlatformAdmin = useAuth().user?.isPlatformAdmin === true;
  const query = useNakamaVersionQuery(isPlatformAdmin);
  const latest = query.data?.updateAvailable ? query.data.latest : null;

  return (
    <div className="space-y-3 px-4 py-3" id="version">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Version</p>
          <VersionStatus query={query} />
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-muted-foreground text-sm tabular-nums">
            {version}
          </p>
          {isPlatformAdmin ? (
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
      {latest ? (
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {`sed -i 's/^NAKAMA_VERSION=.*/NAKAMA_VERSION=${latest}/' .env\ndocker compose pull && docker compose up -d`}
        </pre>
      ) : null}
    </div>
  );
}
