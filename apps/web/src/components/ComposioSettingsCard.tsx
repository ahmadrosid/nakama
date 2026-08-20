import { Link01Icon, ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { IntegrationCardShell } from "@/components/integration-settings.shared";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  useComposioSettings,
  useSaveComposioSettings,
} from "@/hooks/use-composio";
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
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 font-medium text-muted-foreground text-xs">
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-muted-foreground/60"
        />
        Not configured
      </span>
    );
  }

  if (composioReachable) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-800 text-xs dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
        <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-medium text-amber-900 text-xs dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
      Key saved
    </span>
  );
}

function ComposioSettingsSkeleton({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const sectionPadding = embedded ? "pb-1.5" : "p-5";
  const footerPadding = embedded ? "pt-1.5" : "px-5 py-3";

  return (
    <IntegrationCardShell
      busyLabel="Loading Composio settings"
      embedded={embedded}
    >
      {embedded ? null : (
        <>
          <div className="flex items-start justify-between gap-4 p-5 pb-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton-shimmer h-5 w-24 rounded" />
              <div className="skeleton-shimmer h-4 w-full max-w-md rounded" />
              <div className="skeleton-shimmer h-4 w-full max-w-sm rounded" />
            </div>
            <div className="skeleton-shimmer h-6 w-28 shrink-0 rounded-full" />
          </div>

          <div className="border-border border-t" />
        </>
      )}

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

export function ComposioSettingsCard({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
      {embedded ? null : (
        <>
          <div className="flex items-start justify-between gap-4 p-5 pb-4">
            <div className="min-w-0 space-y-1">
              <h2 className="font-semibold text-base text-foreground leading-tight [text-wrap:balance]">
                Composio
              </h2>
              <p className="text-muted-foreground text-sm leading-snug [text-wrap:pretty]">
                Enable toolkits, connect SaaS accounts with OAuth, and sync
                tools for profile assignment.
              </p>
            </div>
            <ComposioStatusBadge
              composioReachable={composioReachable}
              configured={configured}
            />
          </div>

          <div className="border-border border-t" />
        </>
      )}

      <div className={cn("space-y-2", sectionPadding, embedded && "pt-0")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-foreground text-sm">
              Project API key
            </p>
            <p className="text-muted-foreground text-sm [text-wrap:pretty]">
              Paste a Composio project API key, not the MCP consumer key.
            </p>
          </div>
          {embedded ? (
            <ComposioStatusBadge
              composioReachable={composioReachable}
              configured={configured}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <InputGroup className="h-9 min-w-0 flex-1">
            <InputGroupInput
              autoComplete="off"
              disabled={saveMutation.isPending}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (formError) {
                  setFormError(null);
                }
              }}
              placeholder={
                configured && settings?.apiKeyMasked
                  ? `Saved (${settings.apiKeyMasked})`
                  : "Paste API key"
              }
              type={showApiKey ? "text" : "password"}
              value={apiKey}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                className="relative before:absolute before:-inset-2 before:content-['']"
                onClick={() => setShowApiKey((current) => !current)}
                size="icon-xs"
                type="button"
              >
                {showApiKey ? (
                  <ViewOffIcon className="size-4" />
                ) : (
                  <ViewIcon className="size-4" />
                )}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button
            className="min-w-[4.5rem] shrink-0"
            disabled={!canSave || saveMutation.isPending}
            onClick={() => void handleSave()}
            size="sm"
            type="button"
          >
            {saveMutation.isPending ? <Spinner className="size-4" /> : "Save"}
          </Button>
        </div>

        {configured && !composioReachable ? (
          <p
            className="text-amber-800 text-sm dark:text-amber-200"
            role="status"
          >
            The saved key could not reach Composio. Check that it is a project
            API key from Settings → Project Settings → API Keys.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className={cn(footerPadding)}>
        <a
          className="inline-flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
          href="https://dashboard.composio.dev"
          rel="noreferrer"
          target="_blank"
        >
          <Link01Icon aria-hidden className="size-3.5 shrink-0" />
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
