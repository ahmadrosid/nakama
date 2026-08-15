import type {
  AutomationDelivery,
  AutomationDeliveryChannel,
  AutomationRunRecord,
  AutomationRunStatus,
  StoredAutomation,
} from "@nakama/core/contract";
import {
  ArrowRight01Icon,
  BotIcon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit03Icon,
  Loading03Icon,
  PlayIcon,
  Search01Icon,
} from "hugeicons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        aria-label="Run now"
        disabled={busy || runningId !== null}
        onClick={() => void onRun(automation.id)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        {runningId === automation.id ? (
          <Spinner className="size-3.5" />
        ) : (
          <PlayIcon aria-hidden className="ml-px size-3.5" />
        )}
      </Button>
      <Button
        aria-label="Edit"
        disabled={busy}
        onClick={() => onEdit(automation)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Edit03Icon aria-hidden className="size-3.5" />
      </Button>
      <Button
        aria-label="Delete"
        className="text-destructive hover:text-destructive"
        disabled={busy}
        onClick={() => onDelete(automation)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Delete02Icon aria-hidden className="size-3.5" />
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
        "focus-within:bg-muted/25 hover:bg-muted/25",
        selected && "bg-muted/35"
      )}
    >
      <button
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-none"
        onClick={onSelect}
        type="button"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground text-sm">
              {automation.name}
            </p>
            {unreadCount > 0 ? (
              <span
                aria-label={`${unreadCount} unread run${unreadCount === 1 ? "" : "s"}`}
                className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 font-semibold text-2xs text-primary-foreground tabular-nums"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </div>
          <p className="truncate text-muted-foreground text-xs">
            {summarizeAutomationListMeta(automation)}
          </p>
          <div className="flex items-center gap-2">
            <AutomationStateDot enabled={automation.enabled} />
            <p className="text-2xs text-muted-foreground">
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
        aria-label={`Delete ${automation.name}`}
        className="mt-2 mr-2 shrink-0 text-destructive opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        disabled={busy}
        onClick={() => onDelete(automation)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Delete02Icon aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

export function AutomationListSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading automations"
      className="min-h-[12rem] space-y-2 px-2 pb-2"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          className="flex items-start gap-3 rounded-md px-3 py-3"
          key={index}
        >
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
      <Search01Icon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label="Search automations"
        className={cn("pl-9", isSearching && "pr-9")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search…"
        value={value}
      />
      {isSearching ? (
        <button
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={onClear}
          type="button"
        >
          <Cancel01Icon className="size-4" />
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
  const scheduleTrigger =
    automation.trigger.type === "schedule" ? automation.trigger : null;
  const isSchedule = scheduleTrigger !== null;

  return (
    <div className="grid gap-5">
      <Field label="Name">
        <Input
          disabled={busy}
          onChange={(event) => onChange({ name: event.target.value })}
          value={automation.name}
        />
      </Field>

      <Field label="Description">
        <Input
          disabled={busy}
          onChange={(event) => onChange({ description: event.target.value })}
          value={automation.description}
        />
      </Field>

      <Field label="Prompt">
        <Textarea
          className="min-h-32"
          disabled={busy}
          onChange={(event) => onChange({ prompt: event.target.value })}
          value={automation.prompt}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Trigger">
          <Select
            disabled={busy}
            onValueChange={(value) => {
              const type = String(value);

              if (type === "manual") {
                onChange({ trigger: { type: "manual" } });
                return;
              }

              onChange({
                trigger: {
                  cron: scheduleTrigger?.cron ?? "0 8 * * *",
                  timezone: scheduleTrigger?.timezone,
                  type: "schedule",
                },
              });
            }}
            value={automation.trigger.type}
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
          <label className="flex h-8 items-center gap-2 text-foreground text-sm">
            <input
              checked={automation.enabled}
              className="size-4 rounded border-input"
              disabled={busy}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              type="checkbox"
            />
            Run on schedule
          </label>
        </Field>
      </div>

      {isSchedule ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Cron">
            <Input
              disabled={busy}
              onChange={(event) =>
                onChange({
                  trigger: {
                    cron: event.target.value,
                    timezone: scheduleTrigger.timezone,
                    type: "schedule",
                  },
                })
              }
              value={scheduleTrigger.cron}
            />
          </Field>
          <Field label="Timezone">
            <TimezoneSelect
              allowAccountDefault
              disabled={busy}
              onValueChange={(timezone) =>
                onChange({
                  trigger: {
                    cron: scheduleTrigger.cron,
                    timezone,
                    type: "schedule",
                  },
                })
              }
              value={scheduleTrigger.timezone}
            />
          </Field>
        </div>
      ) : null}

      <DeliverySettingsFields
        busy={busy}
        delivery={automation.delivery}
        onChange={(delivery) => onChange({ delivery })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <MetaRow
          hint={
            automation.nextRunAt
              ? formatSessionTimestamp(automation.nextRunAt)
              : undefined
          }
          label="Next run"
          value={
            automation.nextRunAt
              ? formatFutureRelativeTime(automation.nextRunAt)
              : "Not scheduled"
          }
        />
        <MetaRow
          hint={
            automation.lastRunAt
              ? formatSessionTimestamp(automation.lastRunAt)
              : undefined
          }
          label="Last run"
          value={
            automation.lastRunAt
              ? formatSessionRelativeTime(automation.lastRunAt)
              : "Never run"
          }
        />
      </div>
    </div>
  );
}

export function AutomationPanelPlaceholder({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      {children}
    </div>
  );
}

export function AutomationDetailSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading automation"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted/50" />
          <div className="h-10 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted/35" />
        </div>
        <div className="hidden h-9 gap-2 lg:flex">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              className="h-7 w-20 animate-pulse rounded-md bg-muted/40"
              key={index}
            />
          ))}
        </div>
      </div>
      <div className="mb-5 h-9 animate-pulse rounded-md bg-muted/30 lg:hidden" />
      <div className="flex min-h-0 flex-1 flex-col border-border border-t pt-5">
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
        <BotIcon aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="type-section-title">No automations yet</p>
        <p className="type-body text-muted-foreground">
          Ask the agent in Chat to create a scheduled or manual automation for
          you.
        </p>
      </div>
    </div>
  );
}

export function RunHistoryList({
  runs,
  busy,
  running,
  onDeleteRun,
  onRerun,
}: {
  runs: AutomationRunRecord[];
  busy: boolean;
  running: boolean;
  onDeleteRun: (run: AutomationRunRecord) => void;
  onRerun: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(
    () => runs.find((run) => run.status === "running")?.id ?? null
  );

  useEffect(() => {
    const running = runs.find((run) => run.status === "running");

    if (running) {
      setExpandedId(running.id);
    }
  }, [runs]);

  const groups = useMemo(() => groupRunsByDay(runs), [runs]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.label}>
          <p className="sticky top-0 z-10 bg-card pb-2 text-muted-foreground text-xs">
            {group.label}
          </p>
          <ul className="divide-y divide-border/60 border-border/60 border-y">
            {group.runs.map((run) => (
              <RunHistoryItem
                busy={busy}
                expanded={expandedId === run.id}
                key={run.id}
                onDelete={() => onDeleteRun(run)}
                onRerun={onRerun}
                onToggle={() => {
                  setExpandedId((current) =>
                    current === run.id ? null : run.id
                  );
                }}
                run={run}
                running={running}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RunHistoryItem({
  run,
  expanded,
  busy,
  running,
  onToggle,
  onDelete,
  onRerun,
}: {
  run: AutomationRunRecord;
  expanded: boolean;
  busy: boolean;
  running: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRerun: () => void;
}) {
  const isRunning = run.status === "running";
  const isFailed = run.status === "failed";
  const isUnread = run.read === false;
  const hasOutput = Boolean(run.output?.trim());
  const hasError = Boolean(run.error?.trim());
  const hasDeliveryError = Boolean(run.deliveryError?.trim());
  const hasBody = hasOutput || hasError || isRunning || isFailed;
  const previewText = runPreviewText(run);
  const duration = formatRunDuration(run.startedAt, run.completedAt);
  const statusLabel =
    run.status === "completed"
      ? "Completed"
      : run.status === "failed"
        ? "Failed"
        : "Running";
  const metaParts = [
    statusLabel,
    formatSessionRelativeTime(run.startedAt),
    duration,
    run.deliveryStatus === "failed" ? "Delivery failed" : null,
  ].filter(Boolean);
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
      <div className="flex items-start gap-2 py-3">
        <button
          aria-expanded={hasBody ? expanded : undefined}
          aria-label={
            hasBody
              ? `${expanded ? "Collapse" : "Expand"} run from ${formatSessionRelativeTime(run.startedAt)}`
              : `Run from ${formatSessionRelativeTime(run.startedAt)}`
          }
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2.5 text-left",
            !hasBody && "cursor-default"
          )}
          disabled={!hasBody}
          onClick={() => {
            if (hasBody) {
              onToggle();
            }
          }}
          type="button"
        >
          <RunStatusIcon status={run.status} />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
              {isUnread ? (
                <span
                  aria-label="Unread"
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                />
              ) : null}
              <span
                className="truncate"
                title={formatSessionTimestamp(run.startedAt)}
              >
                {metaParts.join(" · ")}
              </span>
            </div>

            {previewText ? (
              <p
                className={cn(
                  "mt-0.5 line-clamp-1 text-sm",
                  run.status === "failed"
                    ? "text-destructive"
                    : "text-foreground/80"
                )}
              >
                {previewText}
              </p>
            ) : null}
          </div>

          {hasBody ? (
            <ArrowRight01Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
          ) : null}
        </button>

        <Button
          aria-label={`Delete run from ${formatSessionRelativeTime(run.startedAt)}`}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={onDelete}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Delete02Icon aria-hidden className="size-4" />
        </Button>
      </div>

      {expanded && hasBody ? (
        <div className="pb-3 pl-7">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p
              className="type-code text-muted-foreground"
              title={formatSessionTimestamp(run.startedAt)}
            >
              {formatSessionTimestamp(run.startedAt)}
              {run.completedAt
                ? ` → ${formatSessionTimestamp(run.completedAt)}`
                : isRunning
                  ? " · running"
                  : ""}
            </p>
            <div className="flex items-center gap-1">
              {isFailed ? (
                <Button
                  className="h-7 gap-1.5 px-2 text-muted-foreground text-xs"
                  disabled={busy || running}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRerun();
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {running ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <PlayIcon aria-hidden className="ml-px size-3.5" />
                  )}
                  Run again
                </Button>
              ) : null}
              {copyText ? (
                <Button
                  className="h-7 gap-1.5 px-2 text-muted-foreground text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCopy();
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy01Icon aria-hidden className="size-3.5" />
                  Copy
                </Button>
              ) : null}
            </div>
          </div>

          {hasDeliveryError ? (
            <p className="mb-3 whitespace-pre-wrap break-words text-destructive text-sm">
              {run.deliveryError}
            </p>
          ) : null}

          {isRunning && !hasOutput && !hasError ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loading03Icon aria-hidden className="size-4 animate-spin" />
              Run in progress…
            </div>
          ) : null}

          {hasError && hasOutput ? (
            <p className="mb-3 whitespace-pre-wrap break-words text-destructive text-sm">
              {run.error}
            </p>
          ) : null}

          {hasOutput ? (
            <div className="max-h-[min(70vh,28rem)] overflow-auto">
              <MessageResponse>{run.output ?? ""}</MessageResponse>
            </div>
          ) : null}

          {!hasOutput && hasError ? (
            <p className="whitespace-pre-wrap break-words text-destructive text-sm">
              {run.error}
            </p>
          ) : null}

          {hasOutput || hasError || isRunning ? null : (
            <p className="text-muted-foreground text-sm">No output returned.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RunStatusIcon({ status }: { status: AutomationRunStatus }) {
  const className = "mt-0.5 size-4 shrink-0";

  if (status === "completed") {
    return (
      <CheckmarkCircle01Icon
        aria-hidden
        className={cn(className, "text-emerald-600 dark:text-emerald-400")}
      />
    );
  }

  if (status === "failed") {
    return (
      <CancelCircleIcon
        aria-hidden
        className={cn(className, "text-destructive")}
      />
    );
  }

  return (
    <Loading03Icon
      aria-hidden
      className={cn(className, "animate-spin text-muted-foreground")}
    />
  );
}

function DeliverySettingsFields({
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
          value={channel}
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
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...delivery,
                to: event.target.value,
              })
            }
            placeholder="you@example.com"
            type="email"
            value={delivery.to ?? ""}
          />
        </Field>
      ) : null}

      {delivery ? (
        <Field label="Notify on">
          <Select
            disabled={busy}
            onValueChange={(value) =>
              onChange({
                ...delivery,
                notifyOn: String(value) as AutomationDelivery["notifyOn"],
              })
            }
            value={delivery.notifyOn ?? "success"}
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

export function AutomationStateBadge({
  enabled,
  className,
}: {
  enabled: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-2xs",
        enabled
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          enabled ? "bg-emerald-500" : "bg-muted-foreground/70"
        )}
      />
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

function AutomationStateDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 rounded-full",
        enabled ? "bg-emerald-500" : "bg-muted-foreground/50"
      )}
    />
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
        "inline-flex items-center rounded-full px-2 py-1 font-medium text-2xs",
        tone === "default" && "bg-muted text-muted-foreground",
        tone === "success" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "danger" && "bg-destructive/10 text-destructive"
      )}
    >
      {label}
    </span>
  );
}

function Field({
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
      <p className="mb-2 block font-medium text-muted-foreground text-xs">
        {label}
      </p>
      {children}
      {hint ? (
        <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function MetaRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="font-medium text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-foreground text-sm" title={hint}>
        {value}
      </p>
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          className="h-10 animate-pulse rounded-md bg-muted/40"
          key={index}
        />
      ))}
    </div>
  );
}
