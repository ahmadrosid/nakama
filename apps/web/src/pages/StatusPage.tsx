import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  CoinsIcon,
  MessageCircleIcon,
  ServerIcon,
  SmartphoneIcon,
  SparklesIcon,
  XCircleIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LlmUsageStatus, SystemStatusResponse } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { useAuth } from "@/context/auth-context";
import { useRefreshSystemStatus, useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";
import { PAGE_PATHS } from "@/lib/navigation";
import { formatProviderLabel } from "@/lib/models";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";
const iconTileClass =
  "flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40";
const iconClass = "size-5 text-foreground";

type StatusTone = "ok" | "warn" | "bad";

export function StatusPage() {
  const { data: status, error, isLoading } = useSystemStatusQuery();
  const { user } = useAuth();
  const refreshSystemStatus = useRefreshSystemStatus();
  const errorMessage = error ? formatError(error) : null;
  const canManageWorkers = user?.isPlatformAdmin === true;

  return (
    <div className="min-w-0 space-y-6">
      {errorMessage ? (
        <div
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
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
        <StatusSkeleton />
      ) : status ? (
        <>
          <StatusDashboard status={status} canManageWorkers={canManageWorkers} />
          <LlmUsageSection usage={status.llmUsage} />
        </>
      ) : null}
    </div>
  );
}

function StatusDashboard({
  status,
  canManageWorkers,
}: {
  status: SystemStatusResponse;
  canManageWorkers: boolean;
}) {
  const summary = useMemo(() => deriveSummary(status), [status]);
  const services = useMemo(() => buildServiceColumns(status), [status]);
  const { automationWorker, telegramWorker, whatsappWorker } = status;

  return (
    <section className={cn(sectionClass, "min-w-0 overflow-hidden")}>
      <SummaryStrip status={status} summary={summary} />

      <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <QuickStat label="Scheduled jobs" value={automationWorker.scheduledJobs} />
        <QuickStat
          label="Automation runs"
          value={automationWorker.activeRuns}
          active={automationWorker.activeRuns > 0}
        />
      </div>

      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {services.map((service) => {
          if (service.title === "Automation") {
            return (
              <WorkerServiceColumn
                key={service.title}
                icon={service.icon}
                title={service.title}
                status={service.status}
                tone={service.tone}
                worker={automationWorker}
                workerName="automation"
                canManage={canManageWorkers}
              />
            );
          }

          if (service.title === "Telegram") {
            return (
              <WorkerServiceColumn
                key={service.title}
                icon={service.icon}
                title={service.title}
                status={service.status}
                tone={service.tone}
                worker={telegramWorker}
                workerName="telegram"
                canManage={canManageWorkers}
              />
            );
          }

          if (service.title === "WhatsApp") {
            return (
              <WorkerServiceColumn
                key={service.title}
                icon={service.icon}
                title={service.title}
                status={service.status}
                tone={service.tone}
                worker={whatsappWorker}
                workerName="whatsapp"
                canManage={canManageWorkers}
                footerLink={
                  whatsappWorker.configured &&
                  whatsappWorker.running &&
                  !whatsappWorker.paired
                    ? { label: "Scan QR in Settings", to: PAGE_PATHS.settings }
                    : undefined
                }
              />
            );
          }

          return <ServiceColumn key={service.title} {...service} />;
        })}
      </div>
    </section>
  );
}

function LlmUsageSection({ usage }: { usage: LlmUsageStatus }) {
  const modelLabel =
    usage.currentModel ??
    (usage.providerConfigured ? "Default model" : "Not configured");
  const hasUsage = usage.requestCount > 0;
  const trackedModelCount = usage.models.length;
  const maxModelTokens = usage.models[0]?.totalTokens ?? 0;

  return (
    <section className={cn(sectionClass, "min-w-0 overflow-hidden")}>
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
                  : usage.provider === "openai_compatible" || usage.provider === "openrouter"
                    ? `Based on pricing saved in Settings for ${modelLabel}. Actual billing may differ.`
                    : `Based on catalog pricing for ${modelLabel}. Actual billing may differ.`
                : usage.provider === "openrouter"
                  ? "Browse or add models in Settings → Manage model to save OpenRouter pricing for cost estimates."
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
      className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4 sm:gap-4"
    >
      <div className={cn(iconTileClass, "bg-background/70")}>
        <ToneIcon tone={summary.tone} className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-foreground">{summary.title}</p>
        <p className="text-sm text-muted-foreground">{summary.description}</p>
        {summary.tone === "warn" ? (
          <Link
            to={PAGE_PATHS.settings}
            className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open Settings
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs leading-none text-muted-foreground">
        <ClockIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span title={formatDate(status.checkedAt)}>Updated {formatRelativeTime(status.checkedAt)}</span>
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

function ServiceColumn({
  icon: Icon,
  title,
  status,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  tone: ServiceStatusTone;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 p-5">
      <span
        className={cn(
          iconTileClass,
          tone === "bad" && "bg-destructive/5",
        )}
      >
        <Icon className={iconClass} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="type-section-title leading-tight">{title}</h2>
        <p
          className={cn(
            "mt-1 text-xs font-medium leading-none",
            tone === "ok" && "text-emerald-700 dark:text-emerald-300",
            tone === "warn" && "text-amber-700 dark:text-amber-300",
            tone === "bad" && "text-destructive",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {status}
        </p>
      </div>
    </div>
  );
}

function MetricsDisplay({
  cpuPercent,
  memoryMb,
}: {
  cpuPercent: number | null | undefined;
  memoryMb: number | null | undefined;
}) {
  if (cpuPercent == null && memoryMb == null) return null;

  return (
    <div className="flex items-center gap-3 border-t border-border px-5 py-2">
      {cpuPercent != null ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ZapIcon className="size-3" aria-hidden />
          CPU: {cpuPercent.toFixed(1)}%
        </span>
      ) : null}
      {memoryMb != null ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ServerIcon className="size-3" aria-hidden />
          Mem: {memoryMb < 1 ? `${(memoryMb * 1024).toFixed(0)} KB` : `${memoryMb.toFixed(1)} MB`}
        </span>
      ) : null}
    </div>
  );
}

function WorkerServiceColumn({
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
  return (
    <div className="flex flex-col">
      <div className="flex min-w-0 items-center gap-3 p-5">
        <span
          className={cn(
            iconTileClass,
            tone === "bad" && "bg-destructive/5",
          )}
        >
          <Icon className={iconClass} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="type-section-title leading-tight">{title}</h2>
          <p
            className={cn(
              "mt-1 text-xs font-medium leading-none",
              tone === "ok" && "text-emerald-700 dark:text-emerald-300",
              tone === "warn" && "text-amber-700 dark:text-amber-300",
              tone === "bad" && "text-destructive",
              tone === "muted" && "text-muted-foreground",
            )}
          >
            {status}
          </p>
        </div>
      </div>
      {canManage ? (
        <WorkerActionBar
          className="border-t border-border px-5 py-2"
          running={worker.running}
          pm2Managed={worker.process?.managed ?? false}
          workerName={workerName}
        />
      ) : null}
      {footerLink ? (
        <div className="border-t border-border px-5 py-2">
          <Link
            to={footerLink.to}
            className="text-xs font-medium text-primary underline underline-offset-4 hover:text-primary/90"
          >
            {footerLink.label}
          </Link>
        </div>
      ) : null}
      <MetricsDisplay
        cpuPercent={worker.process?.cpuPercent}
        memoryMb={worker.process?.memoryMb}
      />
    </div>
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

function StatusSkeleton() {
  return (
    <div
      className="h-80 animate-pulse rounded-md border border-border bg-muted/40"
      aria-busy="true"
      aria-label="Loading system status"
    />
  );
}

export function buildServiceColumns(status: SystemStatusResponse) {
  const { automationWorker, telegramWorker, whatsappWorker } = status;

  return [
    {
      icon: ClockIcon,
      title: "Automation",
      ...automationServiceStatus(automationWorker),
    },
    {
      icon: MessageCircleIcon,
      title: "Telegram",
      ...telegramServiceStatus(telegramWorker),
    },
    {
      icon: SmartphoneIcon,
      title: "WhatsApp",
      ...whatsappServiceStatus(whatsappWorker),
    },
  ];
}

function automationServiceStatus(
  automationWorker: SystemStatusResponse["automationWorker"],
): { status: string; tone: ServiceStatusTone } {
  if (!automationWorker.process?.managed) {
    return { status: "PM2 unavailable", tone: "warn" };
  }

  if (!automationWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (automationWorker.activeRuns > 0) {
    return { status: "Running jobs", tone: "ok" };
  }

  return { status: "Healthy", tone: "ok" };
}

function telegramServiceStatus(
  telegramWorker: SystemStatusResponse["telegramWorker"],
): { status: string; tone: ServiceStatusTone } {
  if (!telegramWorker.configured) {
    return { status: "Not set up", tone: "muted" };
  }

  if (!telegramWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (!telegramWorker.paired) {
    return { status: "Awaiting pairing", tone: "warn" };
  }

  return { status: "Healthy", tone: "ok" };
}

function whatsappServiceStatus(
  whatsappWorker: SystemStatusResponse["whatsappWorker"],
): { status: string; tone: ServiceStatusTone } {
  if (!whatsappWorker.configured) {
    return { status: "Not set up", tone: "muted" };
  }

  if (!whatsappWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (!whatsappWorker.paired) {
    return { status: "Awaiting pairing", tone: "warn" };
  }

  return { status: "Healthy", tone: "ok" };
}

export function deriveSummary(status: SystemStatusResponse): {
  tone: StatusTone;
  title: string;
  description: string;
} {
  if (!status.server.ok) {
    return {
      tone: "bad",
      title: "Server offline",
      description: "Restart Nakama and check your connection.",
    };
  }

  if (!status.automationWorker.ok) {
    return {
      tone: "bad",
      title: "Automation worker stopped",
      description: "Start the automation worker to resume scheduled runs.",
    };
  }

  if (status.telegramWorker.configured && !status.telegramWorker.running) {
    return {
      tone: "warn",
      title: "Telegram bridge offline",
      description: "Start the Telegram worker (bun run dev:telegram) to receive messages.",
    };
  }

  if (status.whatsappWorker.configured && !status.whatsappWorker.running) {
    return {
      tone: "warn",
      title: "WhatsApp offline",
      description: "Start the WhatsApp worker to receive messages.",
    };
  }

  if (!status.server.providerConfigured || !status.automationWorker.providerConfigured) {
    return {
      tone: "warn",
      title: "Running with warnings",
      description: "Configure an LLM provider before chat or automation runs can succeed.",
    };
  }

  return {
    tone: "ok",
    title: "All systems operational",
    description: "Server, workers, and bridges are healthy.",
  };
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
