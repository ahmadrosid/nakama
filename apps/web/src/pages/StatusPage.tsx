import type {
  LlmUsageStatus,
  SystemStatusResponse,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  type Clock01Icon,
  Coins01Icon,
  SparklesIcon,
  ZapIcon,
} from "hugeicons-react";
import { type ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { OrgLlmQuotaCard } from "@/components/settings/OrgLlmQuotaCard";
import {
  WorkerActionBar,
  WorkerViewLogsButton,
} from "@/components/WorkerActionBar";
import { useAuth } from "@/context/use-auth";
import {
  useRefreshSystemStatus,
  useSystemStatusQuery,
} from "@/hooks/use-system-status";
import { usePluginWorkers } from "@/hooks/use-worker-actions";
import { formatUsd } from "@/lib/chat-usage";
import { formatError } from "@/lib/client";
import { formatProviderLabel } from "@/lib/models";
import { PAGE_PATHS, pluginIcon } from "@/lib/navigation";
import { buildServiceColumns } from "@/pages/status-page.shared";

export function StatusPage() {
  const { data: status, error, isLoading } = useSystemStatusQuery();
  const { user } = useAuth();
  const refreshSystemStatus = useRefreshSystemStatus();
  const errorMessage = error ? formatError(error) : null;
  const canManageWorkers = user?.isPlatformAdmin === true;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {errorMessage ? (
        <div
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-destructive text-sm">
            Could not load system status: {errorMessage}
          </p>
          <Button
            className="shrink-0 border-destructive/30 bg-background text-destructive hover:bg-destructive/10"
            onClick={() => void refreshSystemStatus()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}

      {isLoading && !status ? (
        <StatusSkeleton />
      ) : status ? (
        <StatusDashboard canManageWorkers={canManageWorkers} status={status} />
      ) : null}
      <PluginWorkersSection />
    </div>
  );
}

function PluginWorkersSection() {
  const { data = [], error } = usePluginWorkers();
  const { user, activeOrg } = useAuth();
  const canManage = user?.isPlatformAdmin || activeOrg?.role === "admin";
  if (error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {formatError(error)}
      </p>
    );
  }
  if (!data.length) {
    return null;
  }
  return (
    <section aria-label="Plugin workers" className="space-y-3">
      <h2 className="type-section-title">Plugin workers</h2>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="divide-y divide-border p-0">
          {data.map((worker) => {
            const running = worker.process.status === "online";
            const labels = {
              errored: "Errored",
              online: "Online",
              stopped: "Offline",
            };
            return (
              <WorkerServiceRow
                canManage={Boolean(canManage)}
                icon={pluginIcon(worker.pluginId)}
                key={worker.name}
                status={
                  worker.process.status
                    ? labels[worker.process.status]
                    : "Unavailable"
                }
                title={worker.label}
                titleHref={`/plugins/${encodeURIComponent(worker.pluginId)}`}
                tone={running ? "ok" : worker.process.status ? "bad" : "warn"}
                worker={{ process: worker.process, running }}
                workerName={worker.name}
              />
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

function StatusDashboard({
  status,
  canManageWorkers,
}: {
  status: SystemStatusResponse;
  canManageWorkers: boolean;
}) {
  const services = useMemo(() => buildServiceColumns(status), [status]);
  const {
    automationWorker,
    telegramWorker,
    whatsappWorker,
    discordWorker,
    slackWorker,
  } = status;

  const workerByTitle: Record<
    string,
    {
      worker: Pick<
        SystemStatusResponse["automationWorker"],
        "running" | "process"
      >;
      workerName: string;
      footerLink?: { label: string; to: string };
    }
  > = {
    Automation: { worker: automationWorker, workerName: "automation" },
    Discord: { worker: discordWorker, workerName: "discord" },
    Slack: { worker: slackWorker, workerName: "slack" },
    Telegram: { worker: telegramWorker, workerName: "telegram" },
    WhatsApp: {
      footerLink:
        whatsappWorker.configured &&
        whatsappWorker.running &&
        !whatsappWorker.paired
          ? { label: "Scan QR in Settings", to: PAGE_PATHS.settings }
          : undefined,
      worker: whatsappWorker,
      workerName: "whatsapp",
    },
  };

  const workerRows = services.map((service) => ({
    ...service,
    ...workerByTitle[service.title],
  }));

  return (
    <div className="space-y-8">
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <QuickStat
            label="Scheduled jobs"
            value={automationWorker.scheduledJobs}
          />
          <QuickStat
            active={automationWorker.activeRuns > 0}
            label="Automation runs"
            value={automationWorker.activeRuns}
          />
        </CardContent>
      </Card>
      <section aria-label="Services" className="space-y-3">
        <h2 className="type-section-title">Services</h2>
        <Card className="w-full overflow-hidden shadow-none">
          <CardContent className="divide-y divide-border p-0">
            {workerRows.map((row) => (
              <WorkerServiceRow
                canManage={canManageWorkers}
                footerLink={row.footerLink}
                icon={row.icon}
                key={row.title}
                status={row.status}
                title={row.title}
                tone={row.tone}
                worker={row.worker}
                workerName={row.workerName}
              />
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function LlmUsageTab() {
  const { data: status, error, isLoading } = useSystemStatusQuery();
  const refreshSystemStatus = useRefreshSystemStatus();
  const errorMessage = error ? formatError(error) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <OrgLlmQuotaCard />
      {errorMessage ? (
        <div
          className="flex flex-wrap items-start justify-between gap-3 border-destructive/40 border-b bg-destructive/10 px-4 py-3"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-destructive text-sm">
            Could not load usage: {errorMessage}
          </p>
          <Button
            className="shrink-0 border-destructive/30 bg-background text-destructive hover:bg-destructive/10"
            onClick={() => void refreshSystemStatus()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}

      {isLoading && !status ? (
        <div
          aria-busy="true"
          aria-label="Loading LLM usage"
          className="h-80 animate-pulse bg-muted/40"
        />
      ) : status ? (
        <LlmUsageSection usage={status.llmUsage} />
      ) : null}
    </div>
  );
}

function usesSavedModelPricing(provider: LlmUsageStatus["provider"]): boolean {
  return (
    provider === "openai_compatible" ||
    provider === "openrouter" ||
    provider === "cerebras" ||
    provider === "fireworks"
  );
}

function usesBrowsePricingHint(provider: LlmUsageStatus["provider"]): boolean {
  return (
    provider === "openrouter" ||
    provider === "cerebras" ||
    provider === "fireworks"
  );
}

function llmUsageCostNote(
  usage: LlmUsageStatus,
  modelLabel: string,
  trackedModelCount: number
): string {
  if (usage.costEstimated) {
    if (trackedModelCount > 1) {
      return `Based on tracked usage across ${trackedModelCount} models. Actual billing may differ.`;
    }

    if (usesSavedModelPricing(usage.provider)) {
      return `Based on pricing saved in Settings for ${modelLabel}. Actual billing may differ.`;
    }

    return `Based on catalog pricing for ${modelLabel}. Actual billing may differ.`;
  }

  if (usesBrowsePricingHint(usage.provider)) {
    return "Browse or add models in Settings → Manage model to save pricing for cost estimates.";
  }

  return "Add input/output $/1M per model in Customize → AI Providers → Manage models to estimate cost.";
}

function LlmUsageHeader({ usage }: { usage: LlmUsageStatus }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="type-section-title">LLM usage</h2>
          {usage.providerConfigured ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-2xs text-emerald-700 dark:text-emerald-300">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-emerald-500"
              />
              Tracking
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">
          Estimated spend and token volume since the server started.
        </p>
      </div>

      {usage.providerConfigured && usage.provider ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-2.5 py-1 font-medium text-foreground text-xs">
            {formatProviderLabel(usage.provider, usage.displayName)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LlmUsageTrackedBody({
  usage,
  modelLabel,
}: {
  usage: LlmUsageStatus;
  modelLabel: string;
}) {
  const trackedModelCount = usage.models.length;
  const maxModelTokens = usage.models[0]?.totalTokens ?? 0;

  return (
    <div className="space-y-8">
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            <CompactUsageStat
              icon={Coins01Icon}
              label="API cost"
              value={
                usage.costEstimated ? formatUsd(usage.estimatedCostUsd) : "—"
              }
            />
            <CompactUsageStat
              icon={ZapIcon}
              label="Requests"
              value={usage.requestCount.toLocaleString()}
            />
            <CompactUsageStat
              icon={ArrowDownLeft01Icon}
              label="Input"
              value={usage.inputTokens.toLocaleString()}
            />
            <CompactUsageStat
              icon={ArrowUpRight01Icon}
              label="Output"
              value={usage.outputTokens.toLocaleString()}
            />
            <CompactUsageStat
              icon={SparklesIcon}
              label="Total"
              value={usage.totalTokens.toLocaleString()}
            />
          </div>

          <div className="border-border border-t px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
                Token mix
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {usage.inputTokens.toLocaleString()} in /{" "}
                {usage.outputTokens.toLocaleString()} out
              </p>
            </div>
            <TokenMixBar
              inputTokens={usage.inputTokens}
              outputTokens={usage.outputTokens}
            />
          </div>

          <p className="px-4 pb-3 text-muted-foreground text-xs leading-relaxed">
            {llmUsageCostNote(usage, modelLabel, trackedModelCount)}
          </p>
        </CardContent>
      </Card>

      {trackedModelCount > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-section-title">By model</h2>
            <p className="text-muted-foreground text-xs">
              {trackedModelCount} tracked
            </p>
          </div>
          <Card className="w-full overflow-hidden shadow-none">
            <CardContent className="p-0">
              {usage.models.map((modelUsage) => (
                <ModelUsageRow
                  costEstimated={usage.costEstimated}
                  key={modelUsage.modelId}
                  maxTokens={maxModelTokens}
                  usage={modelUsage}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function LlmUsageBody({ usage }: { usage: LlmUsageStatus }) {
  const modelLabel =
    usage.currentModel ??
    (usage.providerConfigured ? "Default model" : "Not configured");

  if (!usage.providerConfigured) {
    return (
      <LlmUsageEmptyState
        action={
          <Link
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            to={PAGE_PATHS.providers}
          >
            Add provider
          </Link>
        }
        description="Add a provider to start tracking token usage and API cost."
        title="Connect a provider to track usage"
      />
    );
  }

  if (usage.requestCount === 0) {
    return (
      <LlmUsageEmptyState
        description="Usage appears here after chat messages, automation runs, or task executions."
        title="No LLM calls yet"
      />
    );
  }

  return <LlmUsageTrackedBody modelLabel={modelLabel} usage={usage} />;
}

function LlmUsageSection({ usage }: { usage: LlmUsageStatus }) {
  return (
    <section className="min-w-0 space-y-8">
      <Card className="w-full shadow-none">
        <CardContent className="p-0">
          <LlmUsageHeader usage={usage} />
        </CardContent>
      </Card>
      <LlmUsageBody usage={usage} />

      <div className="px-4">
        <p className="text-muted-foreground text-xs">
          Tracking since {formatDate(usage.trackedSince)}. Figures reset when
          the server restarts.
        </p>
      </div>
    </section>
  );
}

function LlmUsageEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="w-full shadow-none">
      <CardContent className="flex flex-col items-center px-4 py-8 text-center">
        <p className="text-muted-foreground text-sm">{title}</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-xs">
          {description}
        </p>
        {action ? <div className="mt-4">{action}</div> : null}
      </CardContent>
    </Card>
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
      aria-label={`Input ${inputPercent.toFixed(0)} percent, output ${outputPercent.toFixed(0)} percent`}
      className="flex h-2.5 overflow-hidden rounded-full bg-muted"
      role="img"
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
  icon: typeof Clock01Icon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="font-medium text-foreground text-sm">{label}</p>
      </div>
      <p className="font-medium text-foreground text-sm tabular-nums">
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
    <div className="border-border border-t px-4 py-3 first:border-t-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2 lg:flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate font-mono text-foreground text-sm">
              {usage.modelId}
            </p>
            <p className="text-muted-foreground text-xs">
              {usage.totalTokens.toLocaleString()} tokens
            </p>
          </div>
          <UsageShareBar max={maxTokens} value={usage.totalTokens} />
        </div>

        <div className="flex items-center justify-between gap-4 lg:min-w-[9rem] lg:justify-end">
          <UsageInlineMetric
            align="right"
            label="Req"
            value={usage.requestCount.toLocaleString()}
          />
          <UsageInlineMetric
            align="right"
            label="Cost"
            value={costEstimated ? formatUsd(usage.estimatedCostUsd) : "—"}
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
    <div
      className={cn("min-w-0", align === "right" ? "text-right" : undefined)}
    >
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="truncate font-semibold text-foreground text-sm tabular-nums">
        {value}
      </p>
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
        "flex items-center justify-between gap-3 px-4 py-3",
        active && "bg-primary/5 dark:bg-primary/10"
      )}
    >
      <p className="font-medium text-foreground text-sm">{label}</p>
      <p
        className={cn(
          "font-medium text-foreground text-sm tabular-nums",
          active && "text-primary"
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
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
        tone === "ok" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "warn" &&
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100",
        tone === "bad" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}

function WorkerServiceRow({
  icon: Icon,
  title,
  titleHref,
  status,
  tone,
  worker,
  workerName,
  canManage,
  footerLink,
}: {
  icon: typeof Clock01Icon;
  title: string;
  titleHref?: string;
  status: string;
  tone: ServiceStatusTone;
  worker: Pick<SystemStatusResponse["automationWorker"], "running" | "process">;
  workerName: string;
  canManage: boolean;
  footerLink?: { label: string; to: string };
}) {
  const pm2Managed = worker.process?.managed ?? false;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {titleHref ? (
          <Link
            className="font-medium text-foreground text-sm hover:underline"
            to={titleHref}
          >
            {title}
          </Link>
        ) : (
          <span className="font-medium text-foreground text-sm">{title}</span>
        )}
        <ServiceStatusBadge status={status} tone={tone} />
        {footerLink && (
          <Link
            className="text-primary text-xs underline underline-offset-4"
            to={footerLink.to}
          >
            {footerLink.label}
          </Link>
        )}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <WorkerActionBar
            className="w-fit"
            pm2Managed={pm2Managed}
            running={worker.running}
            showLogs={false}
            workerName={workerName}
          />
          {pm2Managed && <WorkerViewLogsButton workerName={workerName} />}
        </div>
      )}
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading system status"
      className="h-80 animate-pulse rounded-md border border-border bg-muted/40"
    />
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
