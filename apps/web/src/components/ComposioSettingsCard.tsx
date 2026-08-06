import { ExternalLinkIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { IntegrationCardShell } from "@/components/integration-settings.shared";
import { useComposioSettings, useSaveComposioSettings } from "@/hooks/use-composio";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

function ComposioStatusBadge({
  configured,
  composioReachable,
}: {
  configured: boolean;
  composioReachable: boolean;
}) {
  if (!configured) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
        Not configured
      </span>
    );
  }

  if (composioReachable) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Connected
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
      Key saved
    </span>
  );
}

function ComposioSettingsSkeleton({ embedded = false }: { embedded?: boolean }) {
  const sectionPadding = embedded ? "pb-1.5" : "p-5";
  const footerPadding = embedded ? "pt-1.5" : "px-5 py-3";

  return (
    <IntegrationCardShell embedded={embedded} busyLabel="Loading Composio settings">
      {!embedded ? (
        <>
          <div className="flex items-start justify-between gap-4 p-5 pb-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton-shimmer h-5 w-24 rounded" />
              <div className="skeleton-shimmer h-4 w-full max-w-md rounded" />
              <div className="skeleton-shimmer h-4 w-full max-w-sm rounded" />
            </div>
            <div className="skeleton-shimmer h-6 w-28 shrink-0 rounded-full" />
          </div>

          <div className="border-t border-border" />
        </>
      ) : null}

      <div className={cn("space-y-2", sectionPadding, embedded && "pt-0")}>
        <div className="space-y-2">
          <div className="skeleton-shimmer h-4 w-28 rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-4/5 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-9 min-w-0 flex-1 rounded-md" />
          <div className="skeleton-shimmer h-8 w-16 shrink-0 rounded-md" />
        </div>
      </div>

      <div className={cn(footerPadding)}>
        <div className="skeleton-shimmer h-4 w-72 max-w-full rounded" />
      </div>
    </IntegrationCardShell>
  );
}

export function ComposioSettingsCard({ embedded = false }: { embedded?: boolean }) {
  const { data: settings, isLoading, error: loadError } = useComposioSettings();
  const saveMutation = useSaveComposioSettings();
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setApiKey("");
  }, [settings]);

  if (isLoading) {
    return <ComposioSettingsSkeleton embedded={embedded} />;
  }

  const configured = settings?.configured === true;
  const composioReachable = settings?.composioReachable === true;
  const canSave = configured || apiKey.trim().length > 0;
  const errorMessage = formError ?? (loadError ? formatError(loadError) : null);

  const sectionPadding = embedded ? "pb-1.5" : "p-5";
  const footerPadding = embedded ? "pt-1.5" : "px-5 py-3";

  async function handleSave() {
    setFormError(null);

    try {
      await saveMutation.mutateAsync({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  return (
    <IntegrationCardShell embedded={embedded}>
      {!embedded ? (
        <>
          <div className="flex items-start justify-between gap-4 p-5 pb-4">
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold leading-tight text-foreground [text-wrap:balance]">
                Composio
              </h2>
              <p className="text-sm leading-snug text-muted-foreground [text-wrap:pretty]">
                Enable toolkits, connect SaaS accounts with OAuth, and sync tools for profile
                assignment.
              </p>
            </div>
            <ComposioStatusBadge configured={configured} composioReachable={composioReachable} />
          </div>

          <div className="border-t border-border" />
        </>
      ) : null}

      <div className={cn("space-y-2", sectionPadding, embedded && "pt-0")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Project API key</p>
            <p className="text-sm text-muted-foreground [text-wrap:pretty]">
              Paste a Composio project API key — not the MCP consumer key.
            </p>
          </div>
          {embedded ? (
            <ComposioStatusBadge configured={configured} composioReachable={composioReachable} />
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <InputGroup className="h-9 min-w-0 flex-1">
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
                if (formError) {
                  setFormError(null);
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                className="relative before:absolute before:-inset-2 before:content-['']"
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button
            type="button"
            size="sm"
            className="min-w-[4.5rem] shrink-0"
            disabled={!canSave || saveMutation.isPending}
            onClick={() => void handleSave()}
          >
            {saveMutation.isPending ? <Spinner className="size-4" /> : "Save"}
          </Button>
        </div>

        {configured && !composioReachable ? (
          <p className="text-sm text-amber-800 dark:text-amber-200" role="status">
            The saved key could not reach Composio. Check that it is a project API key from Settings
            → Project Settings → API Keys.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className={cn(footerPadding)}>
        <a
          href="https://docs.composio.dev/reference/authentication"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          <span>
            Get a project API key:{" "}
            <span className={cn("font-medium text-primary")}>
              Settings → Project Settings → API Keys
            </span>
          </span>
        </a>
      </div>
    </IntegrationCardShell>
  );
}
