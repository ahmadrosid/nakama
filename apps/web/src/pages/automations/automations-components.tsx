import type {
  AutomationDelivery,
  AutomationDeliveryChannel,
  AutomationRunRecord,
  AutomationRunStatus,
  StoredAutomation,
} from "@nakama/core/contract";
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CopyIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  formatFutureRelativeTime,
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import {
  formatRunDuration,
  groupRunsByDay,
  runHistoryShellClass,
  runPreviewText,
  summarizeAutomationListMeta,
} from "@/pages/automations/automations-page.shared";

export function AutomationDetailActions({
  automation,
  busy,
  runningId,
  onRun,
  onEdit,
  onDelete,
  className,
}: {
  automation: StoredAutomation;
  busy: boolean;
  runningId: string | null;
  onRun: (automationId: string) => void | Promise<void>;
  onEdit: (automation: StoredAutomation) => void;
  onDelete: (automation: StoredAutomation) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy || runningId !== null}
        aria-label="Run now"
        onClick={() => void onRun(automation.id)}
      >
        {runningId === automation.id ? (
          <Spinner className="size-3.5" />
        ) : (
          <PlayIcon className="size-3.5" aria-hidden />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label="Edit"
        onClick={() => onEdit(automation)}
      >
        <PencilIcon className="size-3.5" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label="Delete"
        className="text-destructive hover:text-destructive"
        onClick={() => onDelete(automation)}
      >
        <Trash2Icon className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

export function AutomationListItem({
  automation,
  selected,
  unreadCount,
  busy,
  onSelect,
  onDelete,
}: {
  automation: StoredAutomation;
  selected: boolean;
  unreadCount: number;
  busy: boolean;
  onSelect: () => void;
  onDelete: (automation: StoredAutomation) => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-start gap-2 transition-colors",
        "hover:bg-muted/25 focus-within:bg-muted/25",
        selected && "bg-muted/35",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-none"
        onClick={onSelect}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{automation.name}</p>
            {unreadCount > 0 ? (
              <span
                className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground"
                aria-label={`${unreadCount} unread run${unreadCount === 1 ? "" : "s"}`}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {summarizeAutomationListMeta(automation)}
          </p>
          <div className="flex items-center gap-2">
            <AutomationStateDot enabled={automation.enabled} />
            <p className="text-[11px] text-muted-foreground">
              {automation.nextRunAt
                ? `Next ${formatFutureRelativeTime(automation.nextRunAt)}`
                : automation.lastRunAt
                  ? `Last ${formatSessionRelativeTime(automation.lastRunAt)}`
                  : "No runs yet"}
            </p>
          </div>
        </div>
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={`Delete ${automation.name}`}
        className="mt-2 mr-2 shrink-0 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onDelete(automation)}
      >
        <Trash2Icon className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

export function AutomationListSkeleton() {
  return (
    <div
      className="min-h-[12rem] space-y-2 px-2 pb-2"
      aria-busy="true"
      aria-label="Loading automations"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 rounded-md px-3 py-3">
          <div className="mt-0.5 size-4 shrink-0 animate-pulse rounded bg-muted/50" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
            <div className="h-3 w-14 animate-pulse rounded bg-muted/35" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AutomationSearch({
  value,
  disabled,
  isSearching,
  onChange,
  onClear,
}: {
  value: string;
  disabled: boolean;
  isSearching: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search…"
        disabled={disabled}
        className={cn("pl-9", isSearching && "pr-9")}
        aria-label="Search automations"
      />
      {isSearching ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function AutomationEditorForm({
  automation,
  busy,
  onChange,
}: {
  automation: StoredAutomation;
  busy: boolean;
  onChange: (patch: Partial<StoredAutomation>) => void;
}) {
  const scheduleTrigger = automation.trigger.type === "schedule" ? automation.trigger : null;
  const isSchedule = scheduleTrigger !== null;

  return (
    <div className="grid gap-5">
      <Field label="Name">
        <Input
          value={automation.name}
          disabled={busy}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </Field>

      <Field label="Description">
        <Input
          value={automation.description}
          disabled={busy}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Field>

      <Field label="Prompt">
        <Textarea
          className="min-h-32"
          value={automation.prompt}
          disabled={busy}
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Trigger">
          <Select
            value={automation.trigger.type}
            disabled={busy}
            onValueChange={(value) => {
              const type = String(value);

              if (type === "manual") {
                onChange({ trigger: { type: "manual" } });
                return;
              }

              onChange({
                trigger: {
                  type: "schedule",
                  cron: scheduleTrigger?.cron ?? "0 8 * * *",
                  timezone: scheduleTrigger?.timezone,
                },
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="schedule">Schedule</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Enabled">
          <label className="flex h-8 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={automation.enabled}
              disabled={busy}
              onChange={(event) => onChange({ enabled: event.target.checked })}
            />
            Run on schedule
          </label>
        </Field>
      </div>

      {isSchedule ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Cron">
            <Input
              value={scheduleTrigger.cron}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  trigger: {
                    type: "schedule",
                    cron: event.target.value,
                    timezone: scheduleTrigger.timezone,
                  },
                })
              }
            />
          </Field>
          <Field label="Timezone">
            <TimezoneSelect
              value={scheduleTrigger.timezone}
              disabled={busy}
              allowAccountDefault
              onValueChange={(timezone) =>
                onChange({
                  trigger: {
                    type: "schedule",
                    cron: scheduleTrigger.cron,
                    timezone,
                  },
                })
              }
            />
          </Field>
        </div>
      ) : null}

      <DeliverySettingsFields
        delivery={automation.delivery}
        busy={busy}
        onChange={(delivery) => onChange({ delivery })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <MetaRow
          label="Next run"
          value={
            automation.nextRunAt
              ? formatFutureRelativeTime(automation.nextRunAt)
              : "Not scheduled"
          }
          hint={automation.nextRunAt ? formatSessionTimestamp(automation.nextRunAt) : undefined}
        />
        <MetaRow
          label="Last run"
          value={
            automation.lastRunAt ? formatSessionRelativeTime(automation.lastRunAt) : "Never run"
          }
          hint={automation.lastRunAt ? formatSessionTimestamp(automation.lastRunAt) : undefined}
        />
      </div>
    </div>
  );
}

export function AutomationPanelPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      {children}
    </div>
  );
}

export function AutomationDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading automation">
      <div className="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="min-h-[4.75rem] flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted/50" />
          <div className="h-10 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted/35" />
        </div>
        <div className="hidden h-9 gap-2 lg:flex">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-7 w-20 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      </div>
      <div className="mb-5 h-9 animate-pulse rounded-md bg-muted/30 lg:hidden" />
      <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-5">
        <div className="mb-4 h-10 shrink-0">
          <div className="h-4 w-28 animate-pulse rounded bg-muted/50" />
          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted/35" />
        </div>
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}

export function AutomationsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40">
        <BotIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="type-section-title">No automations yet</p>
        <p className="type-body text-muted-foreground">
          Ask the agent in Chat to create a scheduled or manual automation for you.
        </p>
      </div>
    </div>
  );
}

export function RunHistoryList({
  runs,
  busy,
  onDeleteRun,
}: {
  runs: AutomationRunRecord[];
  busy: boolean;
  onDeleteRun: (run: AutomationRunRecord) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    const running = runs.find((run) => run.status === "running");
    return running?.id ?? runs[0]?.id ?? null;
  });

  useEffect(() => {
    const running = runs.find((run) => run.status === "running");

    if (running) {
      setExpandedId(running.id);
    }
  }, [runs]);

  const groups = useMemo(() => groupRunsByDay(runs), [runs]);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <div className="sticky top-0 z-10 -mx-1 bg-card/95 px-1 pb-1 pt-0.5 backdrop-blur">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {group.label}
            </p>
          </div>
          <ul className="space-y-2">
            {group.runs.map((run) => (
              <RunHistoryItem
                key={run.id}
                run={run}
                expanded={expandedId === run.id}
                busy={busy}
                onToggle={() => {
                  setExpandedId((current) => (current === run.id ? null : run.id));
                }}
                onDelete={() => onDeleteRun(run)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function RunHistoryItem({
  run,
  expanded,
  busy,
  onToggle,
  onDelete,
}: {
  run: AutomationRunRecord;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isRunning = run.status === "running";
  const isUnread = run.read === false;
  const hasOutput = Boolean(run.output?.trim());
  const hasError = Boolean(run.error?.trim());
  const hasDeliveryError = Boolean(run.deliveryError?.trim());
  const hasBody = hasOutput || hasError || isRunning;
  const previewText = runPreviewText(run);
  const duration = formatRunDuration(run.startedAt, run.completedAt);
  const copyText = [hasError ? run.error : null, hasOutput ? run.output : null]
    .filter(Boolean)
    .join("\n\n");

  async function handleCopy() {
    if (!copyText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      // Clipboard may be unavailable outside secure context.
    }
  }

  return (
    <li>
      <article
        className={cn(
          "overflow-hidden rounded-lg border bg-card/90 transition-all",
          runHistoryShellClass(run.status),
        )}
      >
        <div className="flex items-start gap-2 px-4 py-3.5 transition-colors hover:bg-muted/25">
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-start gap-3 text-left",
              !hasBody && "cursor-default",
            )}
            disabled={!hasBody}
            aria-expanded={hasBody ? expanded : undefined}
            aria-label={
              hasBody
                ? `${expanded ? "Collapse" : "Expand"} run from ${formatSessionRelativeTime(run.startedAt)}`
                : `Run from ${formatSessionRelativeTime(run.startedAt)}`
            }
            onClick={() => {
              if (hasBody) {
                onToggle();
              }
            }}
          >
            <RunStatusIcon status={run.status} />

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <RunStatusBadge status={run.status} />
                {run.deliveryStatus ? (
                  <DeliveryStatusBadge status={run.deliveryStatus} error={run.deliveryError} />
                ) : null}
                {isUnread ? (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    New
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground" aria-hidden>
                  ·
                </span>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={run.startedAt}
                  title={formatSessionTimestamp(run.startedAt)}
                >
                  {formatSessionRelativeTime(run.startedAt)}
                </time>
                {duration ? (
                  <>
                    <span className="text-xs text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <span className="text-xs text-muted-foreground">{duration}</span>
                  </>
                ) : null}
              </div>

              {previewText ? (
                <p
                  className={cn(
                    "line-clamp-2 pr-2 text-sm leading-relaxed",
                    run.status === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {previewText}
                </p>
              ) : null}
            </div>

            {hasBody ? (
              <ChevronRightIcon
                className={cn(
                  "mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  expanded && "rotate-90",
                )}
                aria-hidden
              />
            ) : null}
          </button>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={busy}
              aria-label={`Delete run from ${formatSessionRelativeTime(run.startedAt)}`}
              onClick={onDelete}
            >
              <Trash2Icon className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            expanded && hasBody ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border/60 bg-muted/10 px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="type-code text-muted-foreground" title={formatSessionTimestamp(run.startedAt)}>
                  {formatSessionTimestamp(run.startedAt)}
                  {run.completedAt
                    ? ` → ${formatSessionTimestamp(run.completedAt)}`
                    : isRunning
                      ? " · running"
                      : ""}
                </p>
                {copyText ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy();
                    }}
                  >
                    <CopyIcon className="size-3.5" aria-hidden />
                    Copy
                  </Button>
                ) : null}
              </div>

              {(run.deliveryStatus || hasError || hasOutput) && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {run.deliveryStatus ? (
                    <DeliveryStatusBadge status={run.deliveryStatus} error={run.deliveryError} />
                  ) : null}
                  {hasError ? <SoftPill label="Has error" tone="danger" /> : null}
                  {hasOutput ? <SoftPill label="Has output" tone="default" /> : null}
                </div>
              )}

              <Separator className="mb-4 bg-border/60" />

              {hasDeliveryError ? (
                <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-destructive">
                    Delivery error
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-destructive">
                    {run.deliveryError}
                  </p>
                </div>
              ) : null}

              {isRunning && !hasOutput && !hasError ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" aria-hidden />
                  Run in progress…
                </div>
              ) : null}

              {hasError && hasOutput ? (
                <p className="mb-3 whitespace-pre-wrap break-words text-sm text-destructive">
                  {run.error}
                </p>
              ) : null}

              {hasOutput ? (
                <div className="max-h-[min(70vh,28rem)] overflow-auto">
                  <MessageResponse>{run.output ?? ""}</MessageResponse>
                </div>
              ) : null}

              {!hasOutput && !hasError && !isRunning ? (
                <p className="text-sm text-muted-foreground">No output returned.</p>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

export function RunStatusIcon({ status }: { status: AutomationRunStatus }) {
  const className = "mt-0.5 size-4 shrink-0";

  if (status === "completed") {
    return <CheckCircle2Icon className={cn(className, "text-emerald-600 dark:text-emerald-400")} aria-hidden />;
  }

  if (status === "failed") {
    return <XCircleIcon className={cn(className, "text-destructive")} aria-hidden />;
  }

  return <Loader2Icon className={cn(className, "animate-spin text-muted-foreground")} aria-hidden />;
}

export function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        status === "completed" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "failed" && "bg-destructive/10 text-destructive",
        status === "running" && "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

export function DeliverySettingsFields({
  delivery,
  busy,
  onChange,
}: {
  delivery?: AutomationDelivery;
  busy: boolean;
  onChange: (delivery: AutomationDelivery | undefined) => void;
}) {
  const channel = delivery?.channel ?? "none";

  return (
    <div className="grid gap-4 rounded-md border border-border bg-muted/20 p-4">
      <Field label="Send results to">
        <Select
          value={channel}
          disabled={busy}
          onValueChange={(value) => {
            const next = String(value);

            if (next === "none") {
              onChange(undefined);
              return;
            }

            onChange({
              channel: next as AutomationDeliveryChannel,
              ...(next === "email" && delivery?.to ? { to: delivery.to } : {}),
              ...(delivery?.notifyOn ? { notifyOn: delivery.notifyOn } : {}),
            });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (run history only)</SelectItem>
            <SelectItem value="telegram">Telegram</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">Email</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {delivery?.channel === "email" ? (
        <Field label="Email recipient">
          <Input
            type="email"
            value={delivery.to ?? ""}
            disabled={busy}
            placeholder="you@example.com"
            onChange={(event) =>
              onChange({
                ...delivery,
                to: event.target.value,
              })
            }
          />
        </Field>
      ) : null}

      {delivery ? (
        <Field label="Notify on">
          <Select
            value={delivery.notifyOn ?? "success"}
            disabled={busy}
            onValueChange={(value) =>
              onChange({
                ...delivery,
                notifyOn: String(value) as AutomationDelivery["notifyOn"],
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="success">Successful runs</SelectItem>
              <SelectItem value="failure">Failed runs</SelectItem>
              <SelectItem value="both">Success and failure</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

export function DeliveryStatusBadge({
  status,
  error,
}: {
  status: NonNullable<AutomationRunRecord["deliveryStatus"]>;
  error?: string | null;
}) {
  const label =
    status === "sent"
      ? "Delivered"
      : status === "failed"
        ? "Delivery failed"
        : "Delivery skipped";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "sent" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "failed" && "bg-destructive/10 text-destructive",
        status === "skipped" && "bg-muted text-muted-foreground",
      )}
      title={error ?? undefined}
    >
      {label}
    </span>
  );
}

export function AutomationStateBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", enabled ? "bg-emerald-500" : "bg-muted-foreground/70")} />
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

export function AutomationStateDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        enabled ? "bg-emerald-500" : "bg-muted-foreground/50",
      )}
      aria-hidden
    />
  );
}

export function MetaStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "attention";
}) {
  return (
    <div className="rounded-md border border-border/60 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm font-medium",
          tone === "attention" ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function SoftPill({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium",
        tone === "default" && "bg-muted text-muted-foreground",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "danger" && "bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function MetaRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground" title={hint}>
        {value}
      </p>
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-md bg-muted/40" />
      ))}
    </div>
  );
}
