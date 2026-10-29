import type { McpServerSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { buttonVariants } from "@nakama/ui/button-variants";
import { DialogTitle } from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  CodeIcon,
  Search01Icon,
  Tick02Icon,
} from "hugeicons-react";
import type { FormEvent, ReactNode } from "react";
import type { POPULAR_SERVERS } from "@/components/soul-tools/mcp-tab/popular-mcp-servers";
import type { McpServerKind } from "@/components/soul-tools/mcp-tab/use-mcp-server-dialog-state";
import { useMcpServerDetailQuery } from "@/hooks/use-app-queries";
import { queryKeys } from "@/lib/query-keys";

export type PopularServer = (typeof POPULAR_SERVERS)[number];

/** The OAuth callback connects the server on its own, so its status is re-read until it lands. */
const SIGN_IN_POLL_INTERVAL_MS = 3000;

function AppLogo({
  name,
  preset,
  size = "md",
}: {
  name: string;
  preset?: PopularServer;
  size?: "md" | "lg";
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted font-semibold text-foreground/80",
        size === "lg" ? "size-16 rounded-2xl text-xl" : "size-10 rounded-xl"
      )}
    >
      {preset ? (
        <svg
          className={size === "lg" ? "size-8" : "size-5"}
          fill="currentColor"
          viewBox={preset.viewBox}
        >
          <path d={preset.path} />
        </svg>
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      className="-ml-2 self-start text-muted-foreground"
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <ArrowLeft01Icon aria-hidden />
      All apps
    </Button>
  );
}

export function McpAppPicker({
  busy,
  onAssign,
  onConnect,
  onCustom,
  onQueryChange,
  popular,
  query,
  registered,
}: {
  busy: boolean;
  onAssign?: (serverId: string) => void;
  onConnect: (preset: PopularServer) => void;
  onCustom: () => void;
  onQueryChange: (value: string) => void;
  popular: readonly PopularServer[];
  query: string;
  registered: McpServerSummary[];
}) {
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const shownPopular = popular.filter((item) => matches(item.name));

  const shownRegistered = onAssign
    ? registered.filter((item) => matches(item.name))
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 px-6 pt-6 pr-14">
        <DialogTitle className="text-xl">Connect an app</DialogTitle>
        <div className="relative">
          <Search01Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search apps"
            className="pl-9"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search apps"
            type="search"
            value={query}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 py-6">
        {shownPopular.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="font-medium text-muted-foreground text-xs">
              Popular
            </h3>
            <ul className="grid gap-3 sm:grid-cols-3">
              {shownPopular.map((item) => (
                <li key={item.name}>
                  <button
                    className="flex h-full w-full flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => onConnect(item)}
                    type="button"
                  >
                    <AppLogo name={item.name} preset={item} />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium text-foreground text-sm">
                        {item.name}
                      </span>
                      <span className="text-muted-foreground text-xs leading-snug">
                        {item.description}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {shownRegistered.length > 0 && onAssign ? (
          <section className="flex flex-col gap-3">
            <h3 className="font-medium text-muted-foreground text-xs">
              Already set up in your organization
            </h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {shownRegistered.map((item) => (
                <li className="flex items-center gap-3 px-4 py-3" key={item.id}>
                  <AppLogo name={item.name} />
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">
                    {item.name}
                  </span>
                  <Button
                    aria-label={`Add ${item.name} to agent`}
                    disabled={busy}
                    onClick={() => onAssign(item.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Add to agent
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-border border-t px-6 py-3">
        <span className="text-muted-foreground text-sm">
          Don't see your app?
        </span>
        <Button onClick={onCustom} size="sm" type="button" variant="ghost">
          Add a custom connection
        </Button>
      </div>
    </div>
  );
}

const SIGN_IN_CHOICES = [
  { id: "signin", label: "Sign in with my account" },
  { id: "http", label: "Use an API key" },
] as const satisfies readonly { id: McpServerKind; label: string }[];

export function McpCustomConnection({
  children,
  kind,
  onBack,
  onImport,
  onKindChange,
}: {
  children: ReactNode;
  kind: McpServerKind;
  onBack: () => void;
  onImport: () => void;
  onKindChange: (kind: McpServerKind) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <BackButton onClick={onBack} />
      <DialogTitle className="text-xl">Add a custom connection</DialogTitle>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">
          How does it sign in?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SIGN_IN_CHOICES.map((choice) => (
            <label
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm",
                kind === choice.id
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border"
              )}
              key={choice.id}
            >
              <input
                checked={kind === choice.id}
                className="size-4 accent-primary"
                name="mcp-sign-in"
                onChange={() => onKindChange(choice.id)}
                type="radio"
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      <details
        className="text-muted-foreground text-sm"
        open={kind === "stdio"}
      >
        <summary className="cursor-pointer py-1">For developers</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            aria-pressed={kind === "stdio"}
            onClick={() => onKindChange("stdio")}
            size="sm"
            type="button"
            variant={kind === "stdio" ? "secondary" : "outline"}
          >
            Run a command
          </Button>
          <Button onClick={onImport} size="sm" type="button" variant="outline">
            <CodeIcon aria-hidden />
            Import JSON
          </Button>
        </div>
      </details>

      {children}
    </div>
  );
}

export function McpConnectApp({
  busy,
  canSubmit,
  onBack,
  onSubmit,
  preset,
  submitError,
}: {
  busy: boolean;
  canSubmit: boolean;
  onBack: () => void;
  onSubmit: (event: FormEvent) => void;
  preset: PopularServer;
  submitError: string | null;
}) {
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6"
      onSubmit={onSubmit}
    >
      <BackButton onClick={onBack} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AppLogo name={preset.name} preset={preset} size="lg" />
          <DialogTitle className="text-xl">Connect {preset.name}</DialogTitle>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-muted-foreground text-xs">
            Your agent will be able to
          </h3>
          <ul className="flex flex-col gap-2">
            {preset.abilities.map((ability) => (
              <li className="flex items-center gap-2 text-sm" key={ability}>
                <Tick02Icon
                  aria-hidden
                  className="size-4 text-emerald-600 dark:text-emerald-400"
                />
                {ability}
              </li>
            ))}
          </ul>
        </div>

        <p className="rounded-lg bg-muted/60 px-4 py-3 text-muted-foreground text-sm">
          {preset.name} opens in a new tab. Sign in there to approve access.
        </p>

        {submitError ? (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
            role="alert"
          >
            {submitError}
          </p>
        ) : null}

        <Button disabled={busy || !canSubmit} size="lg" type="submit">
          {busy ? <Spinner className="size-4" /> : `Continue to ${preset.name}`}
        </Button>
      </div>
    </form>
  );
}

export function McpSignInPending({
  name,
  onDone,
  opened,
  preset,
  serverId,
  url,
}: {
  name: string;
  onDone: () => void;
  opened: boolean;
  preset?: PopularServer;
  serverId: string;
  url: string;
}) {
  const queryClient = useQueryClient();

  const { data: server } = useMcpServerDetailQuery(serverId, {
    refetchInterval: SIGN_IN_POLL_INTERVAL_MS,
  });

  const connected = server?.status === "connected";

  function finish() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all });
    onDone();
  }

  if (connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <CheckmarkCircle02Icon
          aria-hidden
          className="size-14 text-emerald-600 dark:text-emerald-400"
        />
        <DialogTitle className="text-xl">{name} is connected</DialogTitle>
        <Button className="min-w-40" onClick={finish} size="lg" type="button">
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
      <AppLogo name={name} preset={preset} size="lg" />
      <DialogTitle className="text-xl">Finish signing in to {name}</DialogTitle>
      <p className="max-w-sm text-muted-foreground text-sm">
        Approve access in the {name} tab. This window updates by itself.
      </p>
      <a
        className={cn(
          buttonVariants({
            size: "lg",
            variant: opened ? "outline" : "default",
          }),
          "min-w-56"
        )}
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        {opened ? `Open ${name} again` : `Open ${name}`}
      </a>
      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        Waiting for approval
      </p>
    </div>
  );
}
