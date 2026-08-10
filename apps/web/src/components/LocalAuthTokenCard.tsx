import { Copy01Icon, RefreshIcon } from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useRotateLocalAuthToken } from "@/hooks/use-local-auth-token";
import { formatError } from "@/lib/client";

export function LocalAuthTokenCard() {
  const rotateMutation = useRotateLocalAuthToken();
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function copyToken(): Promise<void> {
    if (!rotatedToken) {
      return;
    }

    await navigator.clipboard.writeText(rotatedToken);
    setHint("Copied to clipboard");
  }

  function handleRotate(): void {
    setFormError(null);
    setHint(null);
    setRotatedToken(null);

    rotateMutation.mutate(undefined, {
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: (response) => {
        setRotatedToken(response.token);
        setHint(
          "New token generated. Copy it now — it will not be shown again."
        );
      },
    });
  }

  const statusLine = formError ?? hint;

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              Local API token
            </p>
            <p className="text-muted-foreground text-xs">
              Used by the CLI, Telegram, and WhatsApp bridges on this machine.
              Rotate if the token may have leaked.
            </p>
            {statusLine ? (
              <p
                className={
                  formError
                    ? "text-destructive text-xs"
                    : "text-emerald-200 text-xs"
                }
                role="status"
              >
                {statusLine}
              </p>
            ) : null}
          </div>
          <Button
            disabled={rotateMutation.isPending}
            onClick={handleRotate}
            size="sm"
            type="button"
            variant="outline"
          >
            {rotateMutation.isPending ? (
              <Spinner />
            ) : (
              <>
                <RefreshIcon aria-hidden="true" className="size-3.5" />
                Rotate token
              </>
            )}
          </Button>
        </div>

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
