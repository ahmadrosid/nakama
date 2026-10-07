import type {
  LlmUsageDayStats,
  LlmUsageGroupStats,
  LlmUsageStats,
  LlmUsageStatus,
  SystemStatusResponse,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { cn } from "@nakama/ui/utils";
import type { Clock01Icon } from "hugeicons-react";
import { type ReactNode, useMemo, useState } from "react";
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

    return "Estimated cost uses Nakama's built-in model prices. Your provider may charge a different amount.";
  }

  if (usesBrowsePricingHint(usage.provider)) {
    return "Browse or add models in Settings → Manage model to save pricing for cost estimates.";
  }

  return "Add input/output $/1M per model in Customize → AI Providers → Manage models to estimate cost.";
}

function LlmUsageTrackedBody({
  usage,
  modelLabel,
}: {
  usage: LlmUsageStatus;
  modelLabel: string;
}) {
  const trackedModelCount = usage.models.length;

  return (
    <div className="space-y-8">
      <UsageDashboard usage={usage} />

      {usage.agents?.length ? (
        <UsageGroupList
          costEstimated={usage.costEstimated}
          groups={usage.agents}
          title="By agent"
        />
      ) : null}

      <p className="px-4 text-muted-foreground text-xs">
        {llmUsageCostNote(usage, modelLabel, trackedModelCount)}
      </p>
    </div>
  );
}

const compactNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});

function formatUsageDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function initialsOf(label: string): string {
  const words = label
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** Darkest shade goes to the provider with the most tokens in the window. */
const PROVIDER_SHADES = [
  "bg-primary/85",
  "bg-primary/55",
  "bg-primary/35",
  "bg-muted-foreground/30",
];

function UsageDashboard({ usage }: { usage: LlmUsageStatus }) {
  const daily = usage.daily ?? [];
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const selected = activeIndex ?? daily.length - 1;
  // Money only when every model has published rates; tokens otherwise.
  const metric = (entry: { estimatedCostUsd: number; totalTokens: number }) =>
    usage.costEstimated ? entry.estimatedCostUsd : entry.totalTokens;
  const formatMetric = (value: number) =>
    usage.costEstimated
      ? formatUsd(value)
      : `${compactNumber.format(value)} tokens`;
  const users = usage.users ?? [];

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardContent className="grid p-0 md:grid-cols-2">
        <UsagePanel
          aside={
            activeIndex !== null && daily[activeIndex]
              ? `${formatUsageDay(daily[activeIndex].day)} · ${formatMetric(metric(daily[activeIndex]))}`
              : `${formatMetric(metric(usage))} · ${usage.requestCount.toLocaleString()} requests`
          }
          title="AI spend"
        >
          <SpendChart
            daily={daily}
            metric={metric}
            onSelect={setActiveIndex}
            selected={selected}
          />
        </UsagePanel>
        <UsagePanel
          aside={providerAside(daily[selected])}
          className="border-border border-t md:border-t-0 md:border-l"
          title="Model providers"
        >
          <ProviderBars
            daily={daily}
            onSelect={setActiveIndex}
            selected={selected}
          />
        </UsagePanel>
        <UsagePanel className="border-border border-t" title="Models">
          <ModelShareList
            formatMetric={formatMetric}
            metric={metric}
            models={usage.models}
          />
        </UsagePanel>
        {users.length > 0 ? (
          <UsagePanel
            className="border-border border-t md:border-l"
            title="Adoption"
          >
            <AdoptionGrid users={users} />
          </UsagePanel>
        ) : null}
      </CardContent>
    </Card>
  );
}

function providerAside(day: LlmUsageDayStats | undefined): string | null {
  const top = day?.providers[0];
  if (!(day && top) || day.totalTokens === 0) {
    return null;
  }
  const percent = Math.round((top.totalTokens / day.totalTokens) * 100);
  return `${formatUsageDay(day.day)} · ${formatProviderLabel(top.provider)} ${percent}%`;
}

function UsagePanel({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 space-y-4 p-4", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-section-title">{title}</h2>
        {aside ? (
          <p className="truncate text-muted-foreground text-xs tabular-nums">
            {aside}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DayAxis({ daily }: { daily: LlmUsageDayStats[] }) {
  if (daily.length === 0) {
    return null;
  }
  const middle = daily[Math.floor((daily.length - 1) / 2)];
  const last = daily.at(-1);
  return (
    <div className="flex justify-between text-2xs text-muted-foreground tabular-nums">
      <span>{formatUsageDay(daily[0].day)}</span>
      {middle ? <span>{formatUsageDay(middle.day)}</span> : null}
      {last ? <span>{formatUsageDay(last.day)}</span> : null}
    </div>
  );
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 120;

function SpendChart({
  daily,
  metric,
  selected,
  onSelect,
}: {
  daily: LlmUsageDayStats[];
  metric: (day: LlmUsageDayStats) => number;
  selected: number;
  onSelect: (index: number | null) => void;
}) {
  const values = daily.map(metric);
  const max = Math.max(...values, 0);
  const step = daily.length > 1 ? CHART_WIDTH / (daily.length - 1) : 0;
  const points = values.map((value, index) => ({
    x: index * step,
    y:
      max > 0
        ? CHART_HEIGHT - (value / max) * (CHART_HEIGHT - 8) - 4
        : CHART_HEIGHT - 4,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const active = points[selected];

  return (
    <div className="space-y-2">
      <svg
        aria-label="Spend per day"
        className="h-32 w-full overflow-visible text-primary"
        onMouseLeave={() => onSelect(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          onSelect(Math.round(ratio * (daily.length - 1)));
        }}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <defs>
          <linearGradient id="usage-spend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {points.length > 1 ? (
          <>
            <polygon
              fill="url(#usage-spend-fill)"
              points={`0,${CHART_HEIGHT} ${line} ${CHART_WIDTH},${CHART_HEIGHT}`}
            />
            <polyline
              fill="none"
              points={line}
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
        {active ? (
          <line
            stroke="currentColor"
            strokeDasharray="2 3"
            strokeOpacity={0.4}
            vectorEffect="non-scaling-stroke"
            x1={active.x}
            x2={active.x}
            y1={0}
            y2={CHART_HEIGHT}
          />
        ) : null}
      </svg>
      <DayAxis daily={daily} />
    </div>
  );
}

function ProviderBars({
  daily,
  selected,
  onSelect,
}: {
  daily: LlmUsageDayStats[];
  selected: number;
  onSelect: (index: number | null) => void;
}) {
  const ranked = useMemo(() => {
    const totals = new Map<string | null, number>();
    for (const day of daily) {
      for (const share of day.providers) {
        totals.set(
          share.provider,
          (totals.get(share.provider) ?? 0) + share.totalTokens
        );
      }
    }
    return [...totals.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([provider]) => provider);
  }, [daily]);
  const shadeOf = (provider: string | null) =>
    PROVIDER_SHADES[
      Math.min(ranked.indexOf(provider), PROVIDER_SHADES.length - 1)
    ];

  return (
    <div className="space-y-2">
      <div
        aria-label="Provider share per day"
        className="flex h-32 items-stretch gap-0.5"
        onMouseLeave={() => onSelect(null)}
        role="img"
      >
        {daily.map((day, index) => (
          <div
            className={cn(
              "flex flex-1 flex-col-reverse overflow-hidden rounded-xs bg-muted transition-opacity",
              index === selected ? "opacity-100" : "opacity-70"
            )}
            key={day.day}
            onMouseEnter={() => onSelect(index)}
          >
            {day.totalTokens > 0
              ? [...day.providers]
                  .sort(
                    (left, right) =>
                      ranked.indexOf(left.provider) -
                      ranked.indexOf(right.provider)
                  )
                  .map((share) => (
                    <div
                      className={shadeOf(share.provider)}
                      key={share.provider ?? ""}
                      style={{
                        height: `${(share.totalTokens / day.totalTokens) * 100}%`,
                      }}
                    />
                  ))
              : null}
          </div>
        ))}
      </div>
      <DayAxis daily={daily} />
    </div>
  );
}

function ShareRing({ share }: { share: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      aria-label={`${Math.round(share * 100)} percent`}
      className="size-5 shrink-0 -rotate-90 text-primary"
      role="img"
      viewBox="0 0 20 20"
    >
      <circle
        className="text-muted"
        cx={10}
        cy={10}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeWidth={3}
      />
      <circle
        cx={10}
        cy={10}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={`${share * circumference} ${circumference}`}
        strokeLinecap="round"
        strokeWidth={3}
      />
    </svg>
  );
}

function ModelShareList({
  models,
  metric,
  formatMetric,
}: {
  models: LlmUsageStatus["models"];
  metric: (entry: LlmUsageStats) => number;
  formatMetric: (value: number) => string;
}) {
  const total = models.reduce((sum, model) => sum + metric(model), 0);
  return (
    <ul className="space-y-3">
      {models.map((model) => (
        <li className="flex items-center gap-3" key={model.modelId}>
          <span className="min-w-0 flex-1 truncate font-mono text-sm">
            {model.modelId}
          </span>
          <span className="text-sm tabular-nums">
            {formatMetric(metric(model))}
          </span>
          <ShareRing share={total > 0 ? metric(model) / total : 0} />
        </li>
      ))}
    </ul>
  );
}

function AdoptionGrid({ users }: { users: LlmUsageGroupStats[] }) {
  return (
    <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4">
      {users.map((user) => {
        const label = user.id ? (user.name ?? user.id) : "Unattributed";
        return (
          <li
            className="flex min-w-0 flex-col items-center gap-1 text-center"
            key={user.id ?? ""}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-10 items-center justify-center rounded-full font-medium text-sm",
                user.id
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {user.id ? initialsOf(label) : "–"}
            </span>
            <span className="w-full truncate text-sm">{label}</span>
            <span className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
              {compactNumber.format(user.requestCount)} requests
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function UsageGroupList({
  title,
  groups,
  costEstimated,
}: {
  title: string;
  groups: LlmUsageGroupStats[];
  costEstimated: boolean;
}) {
  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 0);

  return (
    <div className="space-y-3">
      <h2 className="type-section-title">{title}</h2>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="p-0">
          {groups.map((group) => (
            <UsageRow
              costEstimated={costEstimated}
              key={group.id ?? ""}
              label={group.id ? (group.name ?? group.id) : "Unattributed"}
              maxTokens={maxTokens}
              usage={group}
            />
          ))}
        </CardContent>
      </Card>
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

function UsageRow({
  label,
  usage,
  costEstimated,
  maxTokens,
}: {
  label: string;
  usage: LlmUsageStats;
  costEstimated: boolean;
  maxTokens: number;
}) {
  return (
    <div className="border-border border-t px-4 py-3 first:border-t-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2 lg:flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate text-foreground text-sm">{label}</p>
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
