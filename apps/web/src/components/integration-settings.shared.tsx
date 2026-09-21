import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { CheckmarkCircle01Icon } from "hugeicons-react";
import type { ReactNode } from "react";
import { useStartWorker } from "@/hooks/use-worker-actions";
import { formatError } from "@/lib/client";

export function IntegrationCardShell({
  embedded,
  bordered,
  children,
  className,
  busyLabel,
}: {
  embedded?: boolean;
  bordered?: boolean;
  children: ReactNode;
  className?: string;
  busyLabel?: string;
}) {
  if (embedded && !bordered) {
    return (
      <div
        aria-busy={busyLabel ? true : undefined}
        aria-label={busyLabel}
        className={className}
      >
        {children}
      </div>
    );
  }

  return (
    <Card className={cn("w-full shadow-none", className)}>
      <CardContent
        aria-busy={busyLabel ? true : undefined}
        aria-label={busyLabel}
        className="overflow-hidden p-0"
      >
        {children}
      </CardContent>
    </Card>
  );
}

export const SETTINGS_CARD_LOADING_SKELETON = (
  <div
    aria-hidden="true"
    className="h-16 animate-pulse rounded-lg bg-muted px-4"
  />
);

export function PairingStepTile({
  step,
  title,
  description,
  className,
}: {
  step: number;
  title: string;
  description: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("p-3", className)}>
      <div className="flex items-start gap-2">
        <span className="w-4 shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
          {step}.
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">{title}</p>
          <p className="text-pretty text-muted-foreground text-xs">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingsRow({
  layout = "inline",
  label,
  description,
  children,
  className,
}: {
  layout?: "inline" | "stacked";
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "gap-3 px-4 py-3",
        layout === "stacked"
          ? "flex flex-col"
          : "flex flex-wrap items-center justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-foreground text-sm">{label}</p>
        {description ? (
          <p className="text-pretty text-muted-foreground text-xs">
            {description}
          </p>
        ) : null}
      </div>
      {layout === "stacked" ? (
        <div className="w-full min-w-0">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}

export function IntegrationStatusHeader({
  title,
  subtitle,
  statusBadge,
  configured,
  connected,
  className,
  actions,
}: {
  title: string;
  /** Omit it when the title already says everything, per the AGENTS.md React rule. */
  subtitle?: string;
  statusBadge: string;
  configured: boolean;
  connected: boolean;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 px-4 py-3",
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-balance font-medium text-foreground text-sm">
            {title}
          </p>
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-2xs",
              connected
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : configured
                  ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {statusBadge}
          </span>
        </div>
        {subtitle ? (
          <p className="text-pretty text-muted-foreground text-xs">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

export function ChannelAccessSettings({
  configured,
  statusBadge,
  summary,
  pending,
  onEdit,
  actions,
}: {
  configured: boolean;
  statusBadge: string;
  summary: string;
  pending: boolean;
  onEdit: () => void;
  actions?: ReactNode;
}) {
  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <IntegrationStatusHeader
          actions={actions}
          configured={configured}
          connected={statusBadge === "Connected"}
          statusBadge={statusBadge}
          title="Connection"
        />
        {configured ? (
          <SettingsRow label="Who can message this agent?">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-muted-foreground text-xs">{summary}</span>
              <Button
                disabled={pending}
                onClick={onEdit}
                size="sm"
                type="button"
                variant="outline"
              >
                Edit
              </Button>
            </div>
          </SettingsRow>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function IntegrationSettingsFooter({
  statusLine,
  formError,
  loadError,
  savePending,
  canSave,
  submitLabel,
  onSave,
  showSave = true,
  className,
}: {
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  savePending: boolean;
  canSave: boolean;
  submitLabel: string;
  onSave: () => void;
  showSave?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
        className
      )}
    >
      {statusLine ? (
        <p
          className={cn(
            "min-w-0 text-xs",
            formError || loadError
              ? "text-destructive"
              : "text-emerald-700 dark:text-emerald-300"
          )}
          role={formError || loadError ? "alert" : "status"}
        >
          {statusLine}
        </p>
      ) : (
        <span />
      )}
      {showSave ? (
        <Button
          disabled={savePending || !canSave}
          onClick={onSave}
          size="sm"
          type="button"
        >
          {savePending ? (
            <>
              <Spinner className="size-3" />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      ) : null}
    </div>
  );
}

export function ChannelSetupChecklist({
  label,
  steps,
  step,
  children,
}: {
  label: string;
  steps: string[];
  step: number;
  children: ReactNode;
}) {
  return (
    <ol
      aria-label={label}
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
    >
      {steps.map((label, index) => (
        <li aria-current={index === step ? "step" : undefined} key={label}>
          <div className="flex items-center gap-3 px-4 py-4">
            {index < step ? (
              <CheckmarkCircle01Icon
                aria-hidden
                className="size-5 shrink-0 text-emerald-600"
              />
            ) : (
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground text-xs"
              >
                {index + 1}
              </span>
            )}
            <h2 className="font-medium text-sm">{label}</h2>
            {index < step ? <span className="sr-only">Complete</span> : null}
          </div>
          {index === step ? (
            <div aria-label={label} className="pb-2" role="region">
              {children}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ChannelConnectionStep({
  platform,
  running,
  starting,
  managed,
  children,
}: {
  platform: "discord" | "telegram" | "whatsapp";
  running: boolean;
  starting: boolean;
  managed: boolean;
  children: ReactNode;
}) {
  const start = useStartWorker();
  return (
    <div className="space-y-4 px-4 py-3">
      <p className="text-muted-foreground text-sm">
        {running || starting
          ? "Connecting…"
          : "Start the connection so your agent can receive messages."}
      </p>
      {running || starting ? (
        <Spinner aria-label="Connecting" />
      ) : (
        <Button
          disabled={start.isPending || !managed}
          onClick={() => start.mutate(platform)}
          size="sm"
        >
          {start.isPending ? "Starting…" : "Start connection"}
        </Button>
      )}
      {start.error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(start.error)}
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-muted-foreground text-sm">
          Having trouble?
        </summary>
        <div className="space-y-4 pt-3">{children}</div>
      </details>
    </div>
  );
}

export function ChannelSettings({ children }: { children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-xl border border-border bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-sm outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center justify-between gap-3">
          Settings
          <span className="text-muted-foreground text-xs group-open:hidden">
            Show
          </span>
          <span className="hidden text-muted-foreground text-xs group-open:inline">
            Hide
          </span>
        </span>
      </summary>
      <div className="divide-y divide-border border-border border-t">
        {children}
      </div>
    </details>
  );
}
