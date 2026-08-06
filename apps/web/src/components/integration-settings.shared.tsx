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
          <p className="text-xs text-muted-foreground">{description}</p>
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
          <p className="text-xs text-muted-foreground [text-wrap:pretty]">{description}</p>
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
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", className)}>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground [text-wrap:pretty]">{subtitle}</p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
          connected
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
            : configured
              ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100"
              : "border-border bg-muted text-muted-foreground",
        )}
      >
        {statusBadge}
      </span>
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
              : "text-emerald-800 dark:text-emerald-200",
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
