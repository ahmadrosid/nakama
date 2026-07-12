import { PlugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  useComposioToolkits,
  useConnectComposioToolkit,
  useDisconnectComposioToolkit,
  useEnableComposioToolkit,
  useSyncComposioToolkit,
} from "@/hooks/use-composio";
import { formatError } from "@/lib/client";

function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "oauth_in_progress":
      return "Connecting…";
    case "enabled":
      return "Enabled";
    case "error":
      return "Error";
    default:
      return "Disabled";
  }
}

export function ComposioConnectionsCard() {
  const toolkitsQuery = useComposioToolkits();
  const enableMutation = useEnableComposioToolkit();
  const connectMutation = useConnectComposioToolkit();
  const disconnectMutation = useDisconnectComposioToolkit();
  const syncMutation = useSyncComposioToolkit();

  if (toolkitsQuery.isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (toolkitsQuery.error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {formatError(toolkitsQuery.error)}
        </CardContent>
      </Card>
    );
  }

  const data = toolkitsQuery.data;

  if (!data?.composioAvailable) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Composio is not configured</p>
          <p>Set <code className="rounded bg-muted px-1 py-0.5">COMPOSIO_API_KEY</code> on the server to enable SaaS integrations.</p>
        </CardContent>
      </Card>
    );
  }

  const orgBySlug = new Map(data.orgToolkits.map((toolkit) => [toolkit.toolkitSlug, toolkit]));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Connect apps once per organization. Assigned profiles can use connected toolkits in chat.
      </div>

      <div className="space-y-3">
        {data.catalog.map((catalogToolkit) => {
          const orgToolkit = orgBySlug.get(catalogToolkit.slug);
          const status = orgToolkit?.status ?? "disabled";
          const busy =
            enableMutation.isPending ||
            connectMutation.isPending ||
            disconnectMutation.isPending ||
            syncMutation.isPending;

          return (
            <Card key={catalogToolkit.slug}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PlugIcon className="size-4 text-muted-foreground" />
                    <p className="font-medium text-foreground">{catalogToolkit.name}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {statusLabel(status)}
                    </span>
                  </div>
                  {catalogToolkit.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{catalogToolkit.description}</p>
                  ) : null}
                  {orgToolkit?.lastError ? (
                    <p className="mt-2 text-sm text-destructive">{orgToolkit.lastError}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {status === "disabled" || !orgToolkit ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => enableMutation.mutate(catalogToolkit.slug)}
                    >
                      Enable
                    </Button>
                  ) : null}

                  {status === "enabled" || status === "error" ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => connectMutation.mutate(catalogToolkit.slug)}
                    >
                      Connect
                    </Button>
                  ) : null}

                  {status === "connected" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => syncMutation.mutate(catalogToolkit.slug)}
                      >
                        Sync tools
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => disconnectMutation.mutate(catalogToolkit.slug)}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
