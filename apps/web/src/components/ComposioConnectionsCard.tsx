import { PlugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  useComposioSettings,
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
  const { data: settings } = useComposioSettings();
  const toolkitsQuery = useComposioToolkits();
  const enableMutation = useEnableComposioToolkit();
  const connectMutation = useConnectComposioToolkit();
  const disconnectMutation = useDisconnectComposioToolkit();
  const syncMutation = useSyncComposioToolkit();

  if (toolkitsQuery.isLoading) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="py-3">
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        </CardContent>
      </Card>
    );
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
  const composioAvailable = settings?.configured === true || data?.composioAvailable === true;

  if (!composioAvailable) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Save your Composio API key first</p>
          <p>Once the key is saved above, you can enable and connect SaaS toolkits here.</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const orgBySlug = new Map(data.orgToolkits.map((toolkit) => [toolkit.toolkitSlug, toolkit]));

  return (
    <Card className="w-full shadow-none">
      <CardContent className="p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-foreground">SaaS toolkits</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Connect apps once per organization. Assigned profiles can use connected toolkits in chat.
          </p>
        </div>

        {data.catalog.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No toolkits available yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.catalog.map((catalogToolkit) => {
              const orgToolkit = orgBySlug.get(catalogToolkit.slug);
              const status = orgToolkit?.status ?? "disabled";
              const busy =
                enableMutation.isPending ||
                connectMutation.isPending ||
                disconnectMutation.isPending ||
                syncMutation.isPending;

              return (
                <div
                  key={catalogToolkit.slug}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PlugIcon className="size-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">{catalogToolkit.name}</p>
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {statusLabel(status)}
                      </span>
                    </div>
                    {catalogToolkit.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {catalogToolkit.description}
                      </p>
                    ) : null}
                    {orgToolkit?.lastError ? (
                      <p className="mt-2 text-xs text-destructive">{orgToolkit.lastError}</p>
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
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
