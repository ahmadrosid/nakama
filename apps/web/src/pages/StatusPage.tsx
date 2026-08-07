import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  CoinsIcon,
  SparklesIcon,
  XCircleIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LlmUsageStatus, SystemStatusResponse } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { WorkerActionBar, WorkerViewLogsButton } from "@/components/WorkerActionBar";
import { buildServiceColumns, deriveSummary, type StatusTone } from "@/pages/status-page.shared";
import { useAuth } from "@/context/use-auth";
import { useRefreshSystemStatus, useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";
import { PAGE_PATHS } from "@/lib/navigation";
import { formatProviderLabel } from "@/lib/models";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";
const iconTileClass =
  "flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40";

export function StatusPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: status, error, isLoading } = useSystemStatusQuery();
  const { user } = useAuth();
  const refreshSystemStatus = useRefreshSystemStatus();
  const errorMessage = error ? formatError(error) : null;
  const canManageWorkers = user?.isPlatformAdmin === true;

  return (
    <div className={cn("min-w-0", embedded ? "divide-y divide-border" : "space-y-6")}>
      {errorMessage ? (
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-3 border-destructive/40 bg-destructive/10 px-4 py-3",
            embedded ? "border-b" : "rounded-md border",
          )}
          role="alert"
        >
          <p className="min-w-0 flex-1 text-sm text-destructive">
            Could not load system status: {errorMessage}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-destructive/30 bg-background text-destructive hover:bg-destructive/10"
            onClick={() => void refreshSystemStatus()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {isLoading && !status ? (
        <StatusSkeleton embedded={embedded} />
      ) : status ? (
        <>
          <StatusDashboard
            status={status}
            canManageWorkers={canManageWorkers}
            embedded={embedded}
          />
          <LlmUsageSection usage={status.llmUsage} embedded={embedded} />
        </>
      ) : null}
    </div>
  );
}

function StatusDashboard({
  status,
  canManageWorkers,
  embedded = false,
}: {
  status: SystemStatusResponse;
  canManageWorkers: boolean;
  embedded?: boolean;
}) {
  const summary = useMemo(() => deriveSummary(status), [status]);
  const services = useMemo(() => buildServiceColumns(status), [status]);
  const { automationWorker, telegramWorker, whatsappWorker, discordWorker } = status;

  const workerByTitle: Record<
    string,
    {
      worker: Pick<SystemStatusResponse["automationWorker"], "running" | "process">;
      workerName: string;
      footerLink?: { label: string; to: string };
    }
  > = {
    Automation: { worker: automationWorker, workerName: "automation" },
    Telegram: { worker: telegramWorker, workerName: "telegram" },
    WhatsApp: {
      worker: whatsappWorker,
      workerName: "whatsapp",
      footerLink:
        whatsappWorker.configured && whatsappWorker.running && !whatsappWorker.paired
          ? { label: "Scan QR in Settings", to: PAGE_PATHS.settings }
          : undefined,
    },
    Discord: { worker: discordWorker, workerName: "discord" },
  };

  const workerRows = services.map((service) => ({
    ...service,
    ...workerByTitle[service.title],
  }));

  return (
    <section
      className={cn("min-w-0 overflow-hidden", !embedded && sectionClass)}
    >
      <SummaryStrip status={status} summary={summary} />

      <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <QuickStat label="Scheduled jobs" value={automationWorker.scheduledJobs} />
        <QuickStat
          label="Automation runs"
          value={automationWorker.activeRuns}
          active={automationWorker.activeRuns > 0}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="border-b border-border px-5 py-2.5 font-medium">Service</th>
              <th className="border-b border-border px-5 py-2.5 font-medium">Status</th>
              <th className="border-b border-border px-5 py-2.5 font-medium">
                {canManageWorkers ? "Actions" : <span className="sr-only">Actions</span>}
              </th>
              <th className="border-b border-border px-5 py-2.5 font-medium">
                {canManageWorkers ? "Logs" : <span className="sr-only">Logs</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {workerRows.map((row) => (
              <WorkerServiceRow
                key={row.title}
                icon={row.icon}
                title={row.title}
                status={row.status}
                tone={row.tone}
                worker={row.worker}
                workerName={row.workerName}
                canManage={canManageWorkers}
                footerLink={row.footerLink}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LlmUsageSection({
  usage,
  embedded = false,
}: {
  usage: LlmUsageStatus;
  embedded?: boolean;
}) {
  const modelLabel =
    usage.currentModel ??
    (usage.providerConfigured ? "Default model" : "Not configured");
  const hasUsage = usage.requestCount > 0;
  const trackedModelCount = usage.models.length;
  const maxModelTokens = usage.models[0]?.totalTokens ?? 0;

  return (
    <section className={cn("min-w-0 overflow-hidden", !embedded && sectionClass)}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="type-section-title">LLM usage</h2>
            {usage.providerConfigured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                Tracking
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Estimated spend and token volume since the server started.
          </p>
        </div>

        {usage.providerConfigured && usage.provider ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground">
              {formatProviderLabel(usage.provider, usage.displayName)}
            </span>
          </div>
        ) : null}
      </div>

      {!usage.providerConfigured ? (
        <LlmUsageEmptyState
          icon={SparklesIcon}
          title="Connect a provider to track usage"
          description="Add an API key in Settings to start estimating token usage and API cost."
          action={
            <Link
              to={PAGE_PATHS.settings}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open Settings
            </Link>
          }
        />
      ) : !hasUsage ? (
        <LlmUsageEmptyState
          icon={ZapIcon}
          title="No LLM calls yet"
          description="Usage appears here after chat messages, automation runs, or task executions."
        />
      ) : (
        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-border bg-background/50 p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <CompactUsageStat
                icon={CoinsIcon}
                label="API cost"
                value={usage.costEstimated ? formatUsd(usage.estimatedCostUsd) : "—"}
              />
              <CompactUsageStat
                icon={ZapIcon}
                label="Requests"
                value={usage.requestCount.toLocaleString()}
              />
              <CompactUsageStat
                icon={ArrowDownLeftIcon}
                label="Input"
                value={usage.inputTokens.toLocaleString()}
              />
              <CompactUsageStat
                icon={ArrowUpRightIcon}
                label="Output"
                value={usage.outputTokens.toLocaleString()}
              />
              <CompactUsageStat
                icon={SparklesIcon}
                label="Total"
                value={usage.totalTokens.toLocaleString()}
              />
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Token mix
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out
                </p>
              </div>
              <TokenMixBar inputTokens={usage.inputTokens} outputTokens={usage.outputTokens} />
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {usage.costEstimated
                ? trackedModelCount > 1
                  ? `Based on tracked usage across ${trackedModelCount} models. Actual billing may differ.`
                  : usage.provider === "openai_compatible" ||
                      usage.provider === "openrouter" ||
                      usage.provider === "cerebras" ||
                      usage.provider === "fireworks"
                    ? `Based on pricing saved in Settings for ${modelLabel}. Actual billing may differ.`
                    : `Based on catalog pricing for ${modelLabel}. Actual billing may differ.`
                : usage.provider === "openrouter" || usage.provider === "cerebras" || usage.provider === "fireworks"
                  ? "Browse or add models in Settings → Manage model to save pricing for cost estimates."
                  : "Add input/output $/1M per model in Settings → Manage models to estimate cost."}
            </p>
          </div>

          {trackedModelCount > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="type-label">By model</p>
                <p className="text-xs text-muted-foreground">
                  {trackedModelCount} tracked
                </p>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-background/40">
                {usage.models.map((modelUsage) => (
                  <ModelUsageRow
                    key={modelUsage.modelId}
                    usage={modelUsage}
                    costEstimated={usage.costEstimated}
                    maxTokens={maxModelTokens}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="border-t border-border bg-muted/15 px-5 py-3 dark:bg-muted/10">
        <p className="text-xs text-muted-foreground">
          Tracking since {formatDate(usage.trackedSince)}. Figures reset when the server restarts.
        </p>
      </div>
    </section>
  );
}

function LlmUsageEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-muted/15 px-6 py-10 text-center dark:bg-muted/10">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function TokenMixBar({
  inputTokens,
  outputTokens,
}: {
  inputTokens: number;
  outputTokens: number;
}) {
  const total = inputTokens + outputTokens;
  const inputPercent = total > 0 ? (inputTokens / total) * 100 : 0;
  const outputPercent = total > 0 ? 100 - inputPercent : 0;

  return (
    <div
      className="flex h-2.5 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`Input ${inputPercent.toFixed(0)} percent, output ${outputPercent.toFixed(0)} percent`}
    >
      <div
        className="bg-primary/80 transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${inputPercent}%` }}
      />
      <div
        className="bg-emerald-500/80 transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${outputPercent}%` }}
      />
    </div>
  );
}

function CompactUsageStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}

function ModelUsageRow({
  usage,
  costEstimated,
  maxTokens,
}: {
  usage: LlmUsageStatus["models"][number];
  costEstimated: boolean;
  maxTokens: number;
}) {
  return (
    <div className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2 lg:flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate font-mono text-sm text-foreground">{usage.modelId}</p>
            <p className="text-xs text-muted-foreground">
              {usage.totalTokens.toLocaleString()} tokens
            </p>
          </div>
          <UsageShareBar value={usage.totalTokens} max={maxTokens} />
        </div>

        <div className="flex items-center justify-between gap-4 lg:min-w-[9rem] lg:justify-end">
          <UsageInlineMetric label="Req" value={usage.requestCount.toLocaleString()} align="right" />
          <UsageInlineMetric
            label="Cost"
            value={costEstimated ? formatUsd(usage.estimatedCostUsd) : "—"}
            align="right"
          />
        </div>
      </div>
    </div>
  );
}

function UsageShareBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.max((value / max) * 100, 6) : 0;

  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary/80 transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function UsageInlineMetric({
  label,
  value,
  align = "left",
}: {
  label: string;
  value: string;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" ? "text-right" : undefined)}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function SummaryStrip({
  status,
  summary,
}: {
  status: SystemStatusResponse;
  summary: ReturnType<typeof deriveSummary>;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 border-b border-border px-5 py-4 sm:gap-4",
        summary.tone === "warn" && "bg-amber-500/[0.04] dark:bg-amber-400/[0.05]",
        summary.tone === "bad" && "bg-destructive/5",
      )}
    >
      <div
        className={cn(
          iconTileClass,
          summary.tone === "ok" && "bg-background/70",
          summary.tone === "warn" && "border-amber-500/25 bg-amber-500/10",
          summary.tone === "bad" && "border-destructive/25 bg-destructive/10",
        )}
      >
        <ToneIcon tone={summary.tone} className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-balance text-foreground">{summary.title}</p>
        <p className="text-sm text-pretty text-muted-foreground">{summary.description}</p>
        {summary.action ? (
          <Link
            to={summary.action.to}
            className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {summary.action.label}
          </Link>
        ) : null}
      </div>
      <div className="ml-auto flex basis-full items-center justify-end gap-1.5 text-xs leading-none text-muted-foreground sm:basis-auto">
        <ClockIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span title={formatDate(status.checkedAt)}>
          Updated <span className="tabular-nums">{formatRelativeTime(status.checkedAt)}</span>
        </span>
      </div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  active = false,
}: {
  label: string;
  value: number;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-1 px-5 py-4",
        active && "bg-primary/5 dark:bg-primary/10",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight text-foreground",
          active && "text-primary",
        )}
      >
        {value}
      </p>
    </div>
  );
}

type ServiceStatusTone = "ok" | "warn" | "bad" | "muted";

function ServiceStatusBadge({
  status,
  tone,
}: {
  status: string;
  tone: ServiceStatusTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone === "ok" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "warn" &&
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100",
        tone === "bad" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function WorkerServiceRow({
  icon: Icon,
  title,
  status,
  tone,
  worker,
  workerName,
  canManage,
  footerLink,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  tone: ServiceStatusTone;
  worker: Pick<SystemStatusResponse["automationWorker"], "running" | "process">;
  workerName: string;
  canManage: boolean;
  footerLink?: { label: string; to: string };
}) {
  const pm2Managed = worker.process?.managed ?? false;

  return (
    <tr className="last:[&>td]:border-b-0">
      <td className="border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate font-medium text-foreground">{title}</span>
        </div>
      </td>
      <td className="border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ServiceStatusBadge status={status} tone={tone} />
          {footerLink ? (
            <Link
              to={footerLink.to}
              className="text-xs font-medium text-primary underline underline-offset-4 hover:text-primary/90"
            >
              {footerLink.label}
            </Link>
          ) : null}
        </div>
      </td>
      <td className="border-b border-border px-5 py-3">
        {canManage ? (
          <WorkerActionBar
            className="w-fit"
            running={worker.running}
            pm2Managed={pm2Managed}
            workerName={workerName}
            showLogs={false}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="border-b border-border px-5 py-3">
        {canManage && pm2Managed ? (
          <WorkerViewLogsButton workerName={workerName} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function ToneIcon({ tone, className }: { tone: StatusTone; className?: string }) {
  if (tone === "ok") {
    return (
      <CheckCircle2Icon
        className={cn("text-emerald-600 dark:text-emerald-400", className)}
        aria-hidden
      />
    );
  }

  if (tone === "warn") {
    return (
      <AlertTriangleIcon
        className={cn("text-amber-600 dark:text-amber-400", className)}
        aria-hidden
      />
    );
  }

  return <XCircleIcon className={cn("text-destructive", className)} aria-hidden />;
}

function StatusSkeleton({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <div
      className={cn(
        "h-80 animate-pulse bg-muted/40",
        embedded ? "border-0" : "rounded-md border border-border",
      )}
      aria-busy="true"
      aria-label="Loading system status"
    />
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatUsd(amount: number): string {
  if (amount === 0) {
    return "$0.00";
  }

  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }

  if (amount < 1) {
    return `$${amount.toFixed(3)}`;
  }

  return `$${amount.toFixed(2)}`;
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
