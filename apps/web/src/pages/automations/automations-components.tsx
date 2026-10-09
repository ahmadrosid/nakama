import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type {
  AutomationDelivery,
  AutomationDeliveryChannel,
  AutomationRunRecord,
  AutomationRunStatus,
  ProfileSummary,
  StoredAutomation,
} from "@nakama/core/contract";
import { MAX_SESSION_SEARCH_LENGTH } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { DialogOverlay, DialogTitle } from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Spinner } from "@nakama/ui/spinner";
import { Textarea } from "@nakama/ui/textarea";
import { cn } from "@nakama/ui/utils";
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
import { type ReactNode, useMemo, useState } from "react";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import {
  formatFutureRelativeTime,
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import {
  automationRunMessages,
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
  running,
  onSelect,
  onDelete,
}: {
  automation: StoredAutomation;
  selected: boolean;
  unreadCount: number;
  busy: boolean;
  running: boolean;
  onSelect: () => void;
  onDelete: (automation: StoredAutomation) => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-start gap-2 transition-colors",
        selected
          ? "bg-muted dark:bg-muted/50"
          : "focus-within:bg-muted/25 hover:bg-muted/25"
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
            {unreadCount > 0 ? (
              <span
                aria-label={`${unreadCount} unread run${unreadCount === 1 ? "" : "s"}`}
                className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground tabular-nums leading-none"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
            <p className="truncate font-medium text-foreground text-sm">
              {automation.name}
            </p>
          </div>
          <p className="truncate text-muted-foreground text-xs">
            {summarizeAutomationListMeta(automation)}
          </p>
          <div className="flex items-center gap-2">
            {running ? (
              <Spinner aria-hidden className="size-3 text-primary" />
            ) : (
              <AutomationStateDot enabled={automation.enabled} />
            )}
            <p className="text-2xs text-muted-foreground">
              {running
                ? "Running"
                : automation.nextRunAt
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
  onChange,
  onClear,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      {value ? (
        <button
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
          onClick={onClear}
          type="button"
        >
          <Cancel01Icon aria-hidden className="size-4" />
        </button>
      ) : (
        <Search01Icon
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <Input
        aria-label="Search automations"
        className="border-border/60 bg-white pr-8 pl-2 shadow-none focus-visible:border-border/60 focus-visible:ring-0"
        disabled={disabled}
        maxLength={MAX_SESSION_SEARCH_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClear();
          }
        }}
        placeholder="Search automations"
        value={value}
      />
    </div>
  );
}

export function AutomationEditorForm({
  automation,
  busy,
  onChange,
  profiles,
}: {
  automation: StoredAutomation;
  busy: boolean;
  onChange: (patch: Partial<StoredAutomation>) => void;
  profiles: ProfileSummary[];
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

      <Field label="Profile">
        <Select
          disabled={busy}
          onValueChange={(value) => {
            const profileId = String(value);

            if (profileId) {
              onChange({ profileId });
            }
          }}
          value={automation.profileId}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select profile">
              {
                profiles.find((profile) => profile.id === automation.profileId)
                  ?.name
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                <span className="flex items-center gap-2">
                  <ProfileAvatar profile={profile} size="sm" />
                  <span>{profile.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
  profileId,
  onDeleteRun,
  onRerun,
}: {
  runs: AutomationRunRecord[];
  busy: boolean;
  running: boolean;
  profileId: string;
  onDeleteRun: (run: AutomationRunRecord) => void;
  onRerun: () => void;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const selectedRun = runs.find((run) => run.id === selectedRunId);
  const groups = useMemo(() => groupRunsByDay(runs), [runs]);

  return (
    <DialogPrimitive.Root
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          setSelectedRunId(null);
        }
      }}
      open={open && Boolean(selectedRun)}
    >
      <div className="space-y-4">
        {groups.map((group) => (
          <section className="space-y-3" key={group.label}>
            <p className="text-muted-foreground/55 text-xs">{group.label}</p>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground">
              {group.runs.map((run) => (
                <li
                  className="flex min-w-0 items-center gap-2 px-4 py-3"
                  key={run.id}
                >
                  <DialogPrimitive.Trigger
                    aria-label={`Open run from ${formatSessionTimestamp(run.startedAt)}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <RunStatusIcon status={run.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                        {run.read === false ? (
                          <span
                            aria-label="Unread"
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                          />
                        ) : null}
                        <span
                          className="truncate"
                          title={formatSessionTimestamp(run.startedAt)}
                        >
                          {[
                            runStatusLabel(run.status),
                            formatSessionRelativeTime(run.startedAt),
                            formatRunDuration(run.startedAt, run.completedAt),
                            run.deliveryStatus === "failed"
                              ? "Delivery failed"
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      {runPreviewText(run) ? (
                        <p
                          className={cn(
                            "mt-0.5 line-clamp-1 text-sm",
                            run.status === "failed"
                              ? "text-destructive"
                              : "text-foreground/80"
                          )}
                        >
                          {runPreviewText(run)}
                        </p>
                      ) : null}
                    </div>
                    <ArrowRight01Icon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </DialogPrimitive.Trigger>
                  <Button
                    aria-label={`Delete run from ${formatSessionRelativeTime(run.startedAt)}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={busy || run.status === "running"}
                    onClick={() => onDeleteRun(run)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Delete02Icon aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <DialogPrimitive.Portal>
        <DialogOverlay className="transition-opacity duration-200 ease-out data-closed:animate-none data-open:animate-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl translate-x-0 flex-col border-border border-l bg-background shadow-xl outline-none transition-transform duration-200 ease-out data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full motion-reduce:transition-none">
          <div className="flex shrink-0 items-center gap-3 border-border border-b px-4 py-3">
            {selectedRun ? <RunStatusIcon status={selectedRun.status} /> : null}
            <DialogTitle className="min-w-0 flex-1 truncate text-sm">
              {selectedRun
                ? `${runStatusLabel(selectedRun.status)} · ${formatSessionTimestamp(selectedRun.startedAt)}`
                : "Run conversation"}
            </DialogTitle>
            {selectedRun ? (
              <Button
                aria-label={
                  copiedRunId === selectedRun.id
                    ? "Copied run ID"
                    : "Copy run ID"
                }
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selectedRun.id);
                    setCopiedRunId(selectedRun.id);
                  } catch {
                    // Clipboard may be unavailable outside a secure context.
                  }
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {copiedRunId === selectedRun.id ? (
                  <CheckmarkCircle01Icon aria-hidden className="size-4" />
                ) : (
                  <Copy01Icon aria-hidden className="size-4" />
                )}
              </Button>
            ) : null}
            {selectedRun?.status === "failed" ? (
              <Button
                disabled={busy || running}
                onClick={onRerun}
                size="sm"
                variant="ghost"
              >
                Run again
              </Button>
            ) : null}
            <DialogPrimitive.Close
              render={
                <Button
                  aria-label="Close run conversation"
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <Cancel01Icon aria-hidden className="size-4" />
            </DialogPrimitive.Close>
          </div>
          {selectedRun?.deliveryError ? (
            <p className="px-4 py-2 text-destructive text-sm" role="alert">
              {selectedRun.deliveryError}
            </p>
          ) : null}
          {selectedRun ? (
            <ChatMessageList
              actionsDisabled
              className="min-h-0 flex-1"
              emptyMessage={
                selectedRun.status === "running"
                  ? "Waiting for output…"
                  : "No output returned."
              }
              key={selectedRun.id}
              messages={automationRunMessages(selectedRun)}
              profileId={profileId}
              readOnly
              streamActive={selectedRun.status === "running"}
              turnStartedAt={selectedRun.startedAt}
            />
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function runStatusLabel(status: AutomationRunStatus): string {
  return status === "completed"
    ? "Completed"
    : status === "failed"
      ? "Failed"
      : "Running";
}

function RunStatusIcon({ status }: { status: AutomationRunStatus }) {
  const className = "size-4 shrink-0";

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
    <fieldset className="grid min-w-0 gap-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
      <legend className="sr-only">Delivery</legend>
      <div className={delivery ? "grid gap-4 sm:grid-cols-2" : undefined}>
        <Field label="Send results to">
          <Select
            disabled={busy}
            onValueChange={(value) => {
              const next = String(value);

              if (next === "none") {
                onChange(undefined);

                return;
              }

              const channels: AutomationDeliveryChannel[] = [
                "telegram",
                "whatsapp",
                "email",
                "discord",
              ];

              const nextChannel = channels.find((channel) => channel === next);

              if (!nextChannel) {
                return;
              }

              const nextDelivery: AutomationDelivery = { channel: nextChannel };

              if (next === "email" && delivery?.to) {
                nextDelivery.to = delivery.to;
              }

              if (next === "discord" && delivery?.channelId) {
                nextDelivery.channelId = delivery.channelId;
              }

              if (delivery?.notifyOn) {
                nextDelivery.notifyOn = delivery.notifyOn;
              }

              onChange(nextDelivery);
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
              <SelectItem value="discord">Discord</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {delivery ? (
          <Field label="Notify on">
            <Select
              disabled={busy}
              onValueChange={(value) => {
                const notifyValues: NonNullable<
                  AutomationDelivery["notifyOn"]
                >[] = ["success", "failure", "both"];

                const notifyOn = notifyValues.find(
                  (notifyValue) => notifyValue === String(value)
                );

                if (notifyOn) {
                  onChange({ ...delivery, notifyOn });
                }
              }}
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

      {delivery?.channel === "discord" ? (
        <Field
          hint="Leave blank to DM every paired Discord user."
          label="Discord channel ID"
        >
          <Input
            className="tabular-nums"
            disabled={busy}
            onChange={(event) => {
              const raw = event.target.value.trim();

              const channelId =
                /discord(?:app)?\.com\/channels\/[^/]+\/(\d{17,20})/i.exec(
                  raw
                )?.[1] ?? raw;

              const next = { ...delivery };

              if (channelId) {
                next.channelId = channelId;
              } else {
                delete next.channelId;
              }

              onChange(next);
            }}
            placeholder="Channel ID or discord.com/channels/…"
            value={delivery.channelId ?? ""}
          />
        </Field>
      ) : null}

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
    </fieldset>
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
    <div className="min-w-0">
      <p className="mb-2 block font-medium text-muted-foreground text-xs">
        {label}
      </p>
      {children}
      {hint ? (
        <p className="mt-1.5 text-pretty text-muted-foreground text-xs leading-relaxed">
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
