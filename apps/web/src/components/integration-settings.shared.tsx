import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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
      <div className={className} aria-busy={busyLabel ? true : undefined} aria-label={busyLabel}>
        {children}
      </div>
    );
  }

  return (
    <Card className={cn("w-full shadow-none", className)}>
      <CardContent
        className="overflow-hidden p-0"
        aria-busy={busyLabel ? true : undefined}
        aria-label={busyLabel}
      >
        {children}
      </CardContent>
    </Card>
  );
}

export const SETTINGS_CARD_LOADING_SKELETON = (
  <div className="h-16 animate-pulse rounded-lg bg-muted px-4" aria-hidden="true" />
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
        <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {step}.
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-pretty text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", className)}>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <p className="text-pretty text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
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
}: {
  title: string;
  subtitle: string;
  statusBadge: string;
  configured: boolean;
  connected: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-4 py-3", className)}>
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-balance text-sm font-medium text-foreground">{title}</p>
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
              connected
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : configured
                  ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {statusBadge}
          </span>
        </div>
        <p className="text-pretty text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
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
  className,
}: {
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  savePending: boolean;
  canSave: boolean;
  submitLabel: string;
  onSave: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", className)}>
      {statusLine ? (
        <p
          className={cn(
            "min-w-0 text-xs",
            formError || loadError
              ? "text-destructive"
              : "text-emerald-700 dark:text-emerald-300",
          )}
          role={formError || loadError ? "alert" : "status"}
        >
          {statusLine}
        </p>
      ) : (
        <span />
      )}
      <Button type="button" size="sm" disabled={savePending || !canSave} onClick={onSave}>
        {savePending ? (
          <>
            <Spinner className="size-3" />
            Saving…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  );
}
