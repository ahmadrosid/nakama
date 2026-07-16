import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
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
}: {
  title: string;
  subtitle: string;
  statusBadge: string;
  configured: boolean;
  connected: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
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
}: {
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  savePending: boolean;
  canSave: boolean;
  submitLabel: string;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      {statusLine ? (
        <p
          className={cn(
            "min-w-0 text-xs",
            formError || loadError ? "text-destructive" : "text-emerald-200",
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
            <Spinner className="mr-2" />
            Saving…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  );
}
