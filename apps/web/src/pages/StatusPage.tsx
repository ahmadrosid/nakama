import {
  ActivityIcon,
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  RefreshCwIcon,
  ServerIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useRefreshSystemStatus, useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

export function StatusPage() {
  const { data: status, error, isLoading, isFetching } = useSystemStatusQuery();
  const refreshSystemStatus = useRefreshSystemStatus();

  const initialLoading = isLoading && !status;
  const refreshing = isFetching && !isLoading;
  const errorMessage = error ? formatError(error) : null;
  const overall = useMemo(() => deriveOverallHealth(status ?? null), [status]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="type-page-title">Status</h1>
          <p className="type-body max-w-2xl text-muted-foreground">
            Live health for the TinyClaw server and in-process automation scheduler.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <LiveIndicator active={Boolean(status) && !errorMessage} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            aria-label="Refresh system status"
            onClick={() => void refreshSystemStatus()}
          >
            {refreshing ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" aria-hidden />}
            Refresh
          </Button>
        </div>
      </header>

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <AlertTriangleIcon
              className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-red-900 dark:text-red-100">
                Could not load system status
              </p>
              <p className="text-sm text-red-800 dark:text-red-200">{errorMessage}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-red-300 bg-white text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60"
                onClick={() => void refreshSystemStatus()}
              >
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {initialLoading && !status ? (
        <StatusPageSkeleton />
      ) : status ? (
        <>
          <Card
            className={cn(
              "border",
              overall.tone === "ok"
                ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                : overall.tone === "warn"
                  ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
                  : "border-red-200 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20",
            )}
          >
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <OverallStatusIcon tone={overall.tone} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{overall.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{overall.description}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ClockIcon className="size-3.5 shrink-0" aria-hidden />
                <span title={formatDate(status.checkedAt)}>
                  Updated {formatRelativeTime(status.checkedAt)}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricTile
              label="Scheduled jobs"
              value={status.automationWorker.scheduledJobs}
              hint="Enabled cron automations"
            />
            <MetricTile
              label="Automation runs"
              value={status.automationWorker.activeRuns}
              hint="Currently executing"
              highlight={status.automationWorker.activeRuns > 0}
            />
            <MetricTile
              label="Task runs"
              value={status.taskWorker.activeRuns}
              hint="Agent swarm in progress"
              highlight={status.taskWorker.activeRuns > 0}
            />
            <MetricTile
              label="API version"
              value={status.server.apiVersion}
              hint="Server contract version"
            />
            <MetricTile
              label="Auto refresh"
              value="10s"
              hint="Background polling interval"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ServiceStatusCard
              icon={ServerIcon}
              title="Server"
              subtitle={status.server.ok ? "Online and responding" : "Not reachable"}
              healthy={status.server.ok}
              statusLabel={status.server.ok ? "Healthy" : "Offline"}
              rows={[
                {
                  label: "API version",
                  value: String(status.server.apiVersion),
                },
                {
                  label: "LLM provider",
                  value: status.server.providerConfigured ? "Configured" : "Not configured",
                  tone: status.server.providerConfigured ? "ok" : "warn",
                },
              ]}
            />

            <ServiceStatusCard
              icon={BotIcon}
              title="Automation worker"
              subtitle={
                status.automationWorker.running
                  ? "Scheduler is active"
                  : "Scheduler is not running"
              }
              healthy={status.automationWorker.ok}
              statusLabel={status.automationWorker.running ? "Running" : "Stopped"}
              rows={[
                {
                  label: "Scheduler",
                  value: status.automationWorker.running ? "Active" : "Inactive",
                  tone: status.automationWorker.running ? "ok" : "bad",
                },
                {
                  label: "Scheduled jobs",
                  value: String(status.automationWorker.scheduledJobs),
                },
                {
                  label: "Active runs",
                  value: String(status.automationWorker.activeRuns),
                },
                {
                  label: "LLM provider",
                  value: status.automationWorker.providerConfigured
                    ? "Ready for runs"
                    : "Required for execution",
                  tone: status.automationWorker.providerConfigured ? "ok" : "warn",
                },
              ]}
              footer={describeWorkerHint(status)}
            />

            <ServiceStatusCard
              icon={BotIcon}
              title="Task worker"
              subtitle={
                status.taskWorker.activeRuns > 0
                  ? "Agents are executing swarm tasks"
                  : "No active task runs"
              }
              healthy={status.taskWorker.ok}
              statusLabel={status.taskWorker.activeRuns > 0 ? "Running" : "Idle"}
              rows={[
                {
                  label: "Active runs",
                  value: String(status.taskWorker.activeRuns),
                  tone: status.taskWorker.activeRuns > 0 ? "ok" : undefined,
                },
                {
                  label: "LLM provider",
                  value: status.taskWorker.providerConfigured
                    ? "Ready for runs"
                    : "Required for execution",
                  tone: status.taskWorker.providerConfigured ? "ok" : "warn",
                },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function LiveIndicator({ active }: { active: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {active ? (
          <>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </>
        ) : (
          <span className="relative inline-flex size-2 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      {active ? "Live monitoring" : "Waiting for data"}
    </div>
  );
}

function OverallStatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "ok") {
    return (
      <CheckCircle2Icon
        className="size-8 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    );
  }

  if (tone === "warn") {
    return (
      <AlertTriangleIcon
        className="size-8 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
    );
  }

  return <XCircleIcon className="size-8 shrink-0 text-red-600 dark:text-red-400" aria-hidden />;
}

function MetricTile({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string | number;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-primary/30 bg-primary/5")}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ServiceStatusCard({
  icon: Icon,
  title,
  subtitle,
  healthy,
  statusLabel,
  rows,
  footer,
}: {
  icon: typeof ServerIcon;
  title: string;
  subtitle: string;
  healthy: boolean;
  statusLabel: string;
  rows: Array<{ label: string; value: string; tone?: StatusTone }>;
  footer?: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
              <Icon className="size-5 text-foreground" aria-hidden />
            </div>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="mt-1">{subtitle}</CardDescription>
            </div>
          </div>
          <StatusBadge label={statusLabel} tone={healthy ? "ok" : "bad"} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd>
                {row.tone ? (
                  <StatusBadge label={row.value} tone={row.tone} />
                ) : (
                  <span className="font-medium tabular-nums text-foreground">{row.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {footer ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            <ActivityIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{footer}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: StatusTone | "neutral" }) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      : tone === "bad"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted text-muted-foreground";

  const Icon =
    tone === "ok"
      ? CheckCircle2Icon
      : tone === "bad"
        ? XCircleIcon
        : tone === "warn"
          ? AlertTriangleIcon
          : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClass,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {label}
    </span>
  );
}

function StatusPageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading system status">
      <div className="h-24 animate-pulse rounded-md border border-border bg-muted/40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-md border border-border bg-muted/40" />
        <div className="h-72 animate-pulse rounded-md border border-border bg-muted/40" />
      </div>
    </div>
  );
}

type StatusTone = "ok" | "bad" | "warn";

function deriveOverallHealth(status: import("@tinyclaw/core/contract").SystemStatusResponse | null): {
  tone: StatusTone;
  title: string;
  description: string;
} {
  if (!status) {
    return {
      tone: "bad",
      title: "Status unavailable",
      description: "Unable to determine system health.",
    };
  }

  const serverOk = status.server.ok;
  const workerOk = status.automationWorker.ok;
  const providerReady =
    status.server.providerConfigured && status.automationWorker.providerConfigured;

  if (serverOk && workerOk && providerReady) {
    return {
      tone: "ok",
      title: "All systems operational",
      description: "Server and automation worker are healthy with a configured LLM provider.",
    };
  }

  if (!serverOk || !workerOk) {
    return {
      tone: "bad",
      title: "Action required",
      description: !serverOk
        ? "The server is offline or unreachable. Restart TinyClaw and check your connection."
        : "The automation scheduler is stopped. Restart the TinyClaw server to resume scheduled runs.",
    };
  }

  return {
    tone: "warn",
    title: "Running with warnings",
    description: status.server.providerConfigured
      ? "Automations may fail until an LLM provider is configured in Settings."
      : "Configure an LLM provider in Settings before chat or automation runs can succeed.",
  };
}

function describeWorkerHint(status: import("@tinyclaw/core/contract").SystemStatusResponse): string {
  const worker = status.automationWorker;

  if (!worker.running) {
    return "The automation scheduler is not running. Restart the TinyClaw server.";
  }

  if (worker.activeRuns > 0) {
    return `${worker.activeRuns} automation${worker.activeRuns === 1 ? "" : "s"} executing right now.`;
  }

  if (worker.scheduledJobs === 0) {
    return "No enabled scheduled automations. Manual runs still work from the Automations page or chat.";
  }

  if (!worker.providerConfigured) {
    return `${worker.scheduledJobs} scheduled job${worker.scheduledJobs === 1 ? "" : "s"} are queued, but runs will fail until a provider is configured in Settings.`;
  }

  return `Watching ${worker.scheduledJobs} scheduled automation${worker.scheduledJobs === 1 ? "" : "s"}.`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value: string): string {
  const deltaMs = Date.now() - new Date(value).getTime();
  const seconds = Math.max(0, Math.round(deltaMs / 1000));

  if (seconds < 10) {
    return "just now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return formatDate(value);
}
