import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy01Icon, RefreshIcon } from "hugeicons-react";
import { useState } from "react";
import { client, formatError } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

function useRotateLocalAuthToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.rotateLocalAuthToken(),
    onSuccess: () => invalidateQueries(queryClient, queryKeys.workerLogs),
  });
}

export function LocalAuthTokenCard() {
  const rotateMutation = useRotateLocalAuthToken();
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function copyToken(): Promise<void> {
    if (!rotatedToken) {
      return;
    }

    await navigator.clipboard.writeText(rotatedToken);
    setHint("Copied to clipboard");
  }

  async function handleRotate(): Promise<void> {
    setHint(null);
    setRotatedToken(null);

    try {
      const response = await rotateMutation.mutateAsync();
      setRotatedToken(response.token);
      setHint("New token generated. Copy it now — it will not be shown again.");
    } catch (error) {
      // The dialog stays open and shows this message.
      throw new Error(formatError(error));
    }
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              Local API token
            </p>
            {hint ? (
              <p
                className="text-emerald-700 text-xs dark:text-emerald-300"
                role="status"
              >
                {hint}
              </p>
            ) : null}
          </div>
          <Button
            disabled={rotateMutation.isPending}
            onClick={() => setConfirmOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshIcon aria-hidden="true" className="size-3.5" />
            Rotate token
          </Button>
        </div>
        {confirmOpen ? (
          <ConfirmDialog
            confirmLabel="Rotate"
            description="The CLI, Telegram, and WhatsApp bridges on this machine stop working until they load the new token."
            onClose={() => setConfirmOpen(false)}
            onConfirm={handleRotate}
            title="Rotate the local API token?"
          />
        ) : null}

        {rotatedToken ? (
          <div className="space-y-3 px-4 py-3">
            <p className="text-muted-foreground text-xs">
              Running workers reload the token from disk after the next failed
              request. Restart them if anything stays disconnected.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full break-all rounded-md border border-border bg-background px-2.5 py-1 text-xs">
                {rotatedToken}
              </code>
              <Button
                onClick={() => void copyToken()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy01Icon className="size-4" />
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
