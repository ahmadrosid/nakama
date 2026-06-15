import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleGaugeIcon,
  ClockIcon,
  CoinsIcon,
  KanbanIcon,
  MessageCircleIcon,
  ServerIcon,
  SmartphoneIcon,
  SparklesIcon,
  WorkflowIcon,
  XCircleIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LlmUsageStatus, SystemStatusResponse } from "@tinyclaw/core/contract";
import { Button } from "@/components/ui/button";
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
  const refreshSystemStatus = useRefreshSystemStatus();
  const errorMessage = error ? formatError(error) : null;

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md">
            <CircleGaugeIcon className={iconClass} aria-hidden />
          </div>
          <div className="min-w-0 space-y-0.5">
            <h1 className="type-page-title">Status</h1>
            <p className="type-body max-w-2xl">
              Live health for the server, workers, and message bridges.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <LiveIndicator active={Boolean(status) && !errorMessage} />
        </div>
      </header>

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
          <StatusDashboard status={status} />
          <LlmUsageSection usage={status.llmUsage} />
        </>
      ) : null}
    </div>
  );
}

function StatusDashboard({ status }: { status: SystemStatusResponse }) {
  const summary = useMemo(() => deriveSummary(status), [status]);
  const services = useMemo(() => buildServiceColumns(status), [status]);
  const { automationWorker, taskWorker } = status;

  return (
    <section className={cn(sectionClass, "min-w-0 overflow-hidden")}>
      <SummaryStrip status={status} summary={summary} />

      <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <QuickStat label="Scheduled jobs" value={automationWorker.scheduledJobs} />
        <QuickStat
          label="Automation runs"
          value={automationWorker.activeRuns}
          active={automationWorker.activeRuns > 0}
        />
        <QuickStat
          label="Task runs"
          value={taskWorker.activeRuns}
          active={taskWorker.activeRuns > 0}
        />
      </div>

      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-y-0">
        {services.map((service) => (
          <ServiceColumn key={service.title} {...service} />
        ))}
      </div>
    </section>
  );
}

function LlmUsageSection({ usage }: { usage: LlmUsageStatus }) {
  const modelLabel =
    usage.currentModel ??
    (usage.providerConfigured ? "Default model" : "Not configured");
  const hasUsage = usage.requestCount > 0;

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
            <span className="inline-flex max-w-[16rem] items-center truncate rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground">
              {modelLabel}
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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
            <div className="rounded-lg border border-border bg-gradient-to-br from-primary/5 via-card to-card p-5 dark:from-primary/10">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="type-label">
                    {usage.costEstimated ? "Estimated API cost" : "API cost"}
                  </p>
                  <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                    {usage.costEstimated ? formatUsd(usage.estimatedCostUsd) : "—"}
                  </p>
                </div>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CoinsIcon className="size-5" aria-hidden />
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {usage.costEstimated
                  ? usage.provider === "openai_compatible" || usage.provider === "openrouter"
                    ? `Based on pricing saved in Settings for ${modelLabel}. Actual billing may differ.`
                    : `Based on catalog pricing for ${modelLabel}. Actual billing may differ.`
                  : usage.provider === "openrouter"
                    ? "Browse or add models in Settings → Manage model to save OpenRouter pricing for cost estimates."
                    : "Add input/output $/1M per model in Settings → Manage models to estimate cost."}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-5 dark:bg-muted/10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="type-label">Token mix</p>
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {usage.totalTokens.toLocaleString()} total
                </p>
              </div>
              <TokenMixBar inputTokens={usage.inputTokens} outputTokens={usage.outputTokens} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <TokenMixLegend
                  icon={ArrowDownLeftIcon}
                  label="Input"
                  value={usage.inputTokens}
                  tone="primary"
                />
                <TokenMixLegend
                  icon={ArrowUpRightIcon}
                  label="Output"
                  value={usage.outputTokens}
                  tone="emerald"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <UsageMetricTile
              icon={ZapIcon}
              label="Requests"
              value={usage.requestCount.toLocaleString()}
              hint="Completed LLM calls"
            />
            <UsageMetricTile
              icon={ArrowDownLeftIcon}
              label="Input tokens"
              value={usage.inputTokens.toLocaleString()}
              hint="Prompt and context"
            />
            <UsageMetricTile
              icon={ArrowUpRightIcon}
              label="Output tokens"
              value={usage.outputTokens.toLocaleString()}
              hint="Model responses"
            />
          </div>
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

function TokenMixLegend({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: "primary" | "emerald";
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border/70 bg-background/70 px-3 py-2.5">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          tone === "primary" ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function UsageMetricTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/60 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
      </div>
    </div>
  );
}

function LiveIndicator({ active }: { active: boolean }) {
  return (
    <div
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-muted/30 px-3 text-xs font-medium text-muted-foreground"
      aria-live="polite"
    >
      <span className="relative flex size-2 shrink-0">
        {active ? (
          <>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </>
        ) : (
          <span className="relative inline-flex size-2 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <span className={active ? "text-emerald-800 dark:text-emerald-200" : undefined}>
        {active ? "Live" : "Waiting"}
      </span>
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
        "flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 sm:gap-4",
        summary.tone === "ok" && "bg-emerald-50/40 dark:bg-emerald-950/10",
        summary.tone === "warn" && "bg-amber-50/40 dark:bg-amber-950/10",
        summary.tone === "bad" && "bg-destructive/5",
      )}
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

function buildServiceColumns(status: SystemStatusResponse) {
  const { server, automationWorker, telegramWorker, whatsappWorker } = status;

  return [
    {
      icon: ServerIcon,
      title: "Server",
      ...serverServiceStatus(server),
    },
    {
      icon: WorkflowIcon,
      title: "Automation",
      ...workerServiceStatus(automationWorker.ok, "Stopped"),
    },
    {
      icon: KanbanIcon,
      title: "Tasks",
      status: "Healthy",
      tone: "ok" as const,
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

function serverServiceStatus(server: SystemStatusResponse["server"]): {
  status: string;
  tone: ServiceStatusTone;
} {
  if (!server.ok) {
    return { status: "Offline", tone: "bad" };
  }

  if (!server.providerConfigured) {
    return { status: "No provider", tone: "warn" };
  }

  return { status: "Healthy", tone: "ok" };
}

function workerServiceStatus(
  ok: boolean,
  offlineLabel: string,
): { status: string; tone: ServiceStatusTone } {
  return ok
    ? { status: "Healthy", tone: "ok" }
    : { status: offlineLabel, tone: "bad" };
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

function deriveSummary(status: SystemStatusResponse): {
  tone: StatusTone;
  title: string;
  description: string;
} {
  if (!status.server.ok) {
    return {
      tone: "bad",
      title: "Server offline",
      description: "Restart TinyClaw and check your connection.",
    };
  }

  if (!status.automationWorker.ok) {
    return {
      tone: "bad",
      title: "Automation worker stopped",
      description: "Restart the server to resume scheduled runs.",
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
      title: "WhatsApp bridge offline",
      description: "Start the WhatsApp worker (bun run dev:whatsapp) to receive messages.",
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
