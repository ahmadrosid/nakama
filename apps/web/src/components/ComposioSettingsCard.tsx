import { PlugIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useComposioSettings, useSaveComposioSettings } from "@/hooks/use-composio";
import { formatError } from "@/lib/client";

export function ComposioSettingsCard() {
  const { data: settings, isLoading, error: loadError } = useComposioSettings();
  const saveMutation = useSaveComposioSettings();
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setApiKey("");
  }, [settings]);

  if (isLoading) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="py-3">
          <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const configured = settings?.configured === true;
  const canSave = configured || apiKey.trim().length > 0;
  const statusLine =
    hint ?? (formError ? formError : null) ?? (loadError ? formatError(loadError) : null);

  async function handleSave() {
    setHint(null);
    setFormError(null);

    try {
      await saveMutation.mutateAsync({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      setHint("Composio API key saved.");
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <PlugIcon className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Composio API key</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {configured
                ? "Saved on this server. Enable and connect SaaS toolkits below."
                : "Paste your Composio API key to enable SaaS integrations."}
            </p>
          </div>
          <span
            className={
              configured
                ? "shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
            }
          >
            {configured ? "Configured" : "Not configured"}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">API key</p>
            <p className="text-xs text-muted-foreground">
              Saved to <code className="rounded bg-muted px-1 py-0.5">~/.nakama/composio/config.ini</code>
            </p>
          </div>
          <InputGroup className="w-full min-w-[12rem] sm:w-[18rem]">
            <InputGroupInput
              type={showApiKey ? "text" : "password"}
              autoComplete="off"
              placeholder={
                configured && settings?.apiKeyMasked
                  ? `Saved (${settings.apiKeyMasked})`
                  : "Paste API key"
              }
              value={apiKey}
              disabled={saveMutation.isPending}
              onChange={(event) => {
                setApiKey(event.target.value);
                setHint(null);
                if (formError) {
                  setFormError(null);
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Get a key from{" "}
            <a
              href="https://app.composio.dev"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline-offset-4 hover:underline"
            >
              Composio
            </a>
            .
          </p>
          <Button
            type="button"
            size="sm"
            disabled={!canSave || saveMutation.isPending}
            onClick={() => void handleSave()}
          >
            {saveMutation.isPending ? <Spinner className="size-4" /> : "Save"}
          </Button>
        </div>

        {statusLine ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{statusLine}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
