import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type {
  AutomationDelivery,
  AutomationRunRecord,
  AutomationRunStatus,
  ProfileSummary,
  StoredAutomation,
} from "@nakama/core/contract";
import { MAX_SESSION_SEARCH_LENGTH } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Command, CommandItem, CommandList } from "@nakama/ui/command";
import { DialogOverlay, DialogTitle } from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from "@nakama/ui/popover";
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
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  Loading03Icon,
  Search01Icon,
} from "hugeicons-react";
import { type ReactNode, useMemo, useState } from "react";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { useUserTimezone } from "@/hooks/use-timezones";
import {
  formatFutureRelativeTime,
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import {
  automationRunMessages,
  formatRunDuration,
  HOURLY_INTERVALS,
  previewAutomationSchedule,
  readSchedulePreset,
  runPreviewText,
  schedulePresetTrigger,
  summarizeAutomationListMeta,
} from "@/pages/automations/automations-page.shared";

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

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = String((index % 4) * 15).padStart(2, "0");

  return {
    label: `${hour % 12 || 12}:${minute}${hour < 12 ? "am" : "pm"}`,
    value: `${String(hour).padStart(2, "0")}:${minute}`,
  };
});

function hoursLabel(hours: string) {
  return hours === "1" ? "1 hour" : `${hours} hours`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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

  return (
    <div className="grid gap-6">
      <Field label="Name">
        <Input
          aria-label="Name"
          className="h-auto rounded-none border-transparent px-0 py-1 font-semibold text-xl shadow-none md:text-xl"
          disabled={busy}
          onChange={(event) => onChange({ name: event.target.value })}
          value={automation.name}
        />
      </Field>
      <Field label="Assistant">
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
      <Field label="What should it do?">
        <Textarea
          aria-label="What should it do?"
          className="min-h-24 resize-y rounded-xl p-3 text-sm leading-relaxed"
          disabled={busy}
          onChange={(event) => onChange({ prompt: event.target.value })}
          value={automation.prompt}
        />
      </Field>
      <AutomationScheduleFields
        automation={automation}
        busy={busy}
        onChange={onChange}
      />
      <DeliverySettingsFields
        busy={busy}
        delivery={automation.delivery}
        onChange={(delivery) => onChange({ delivery })}
      />
      <details className="group border-border border-t pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold sm:min-h-10 [&::-webkit-details-marker]:hidden">
          More options
          <ArrowDown01Icon
            aria-hidden
            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-4 pt-3">
          <Field label="Notes">
            <Input
              disabled={busy}
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
              value={automation.description}
            />
          </Field>

          {scheduleTrigger ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Advanced schedule">
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
          <div>
            {automation.delivery ? (
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

                    if (notifyOn && automation.delivery) {
                      onChange({
                        delivery: { ...automation.delivery, notifyOn },
                      });
                    }
                  }}
                  value={automation.delivery.notifyOn ?? "success"}
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
        </div>
      </details>
    </div>
  );
}

function AutomationScheduleFields({
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

  const preset = readSchedulePreset(automation.trigger);

  const frequency =
    automation.trigger.type === "manual"
      ? "manual"
      : (preset?.frequency ?? "custom");

  return (
    <>
      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-2 font-semibold text-sm">How often?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["manual", "Only when I ask"],
              ["hourly", "Hourly"],
              ["daily", "Every day"],
              ["weekdays", "Weekdays"],
              ["weekly", "Weekly"],
              ["monthly", "Monthly"],
            ] as const
          ).map(([value, label]) => (
            <Button
              aria-pressed={frequency === value}
              className="h-auto min-h-11 rounded-full px-3 py-2 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-primary sm:min-h-10"
              disabled={busy}
              key={value}
              onClick={() =>
                onChange({
                  trigger: schedulePresetTrigger(value, automation.trigger),
                })
              }
              type="button"
              variant="outline"
            >
              {label}
            </Button>
          ))}
        </div>
        {preset?.frequency === "weekly" && scheduleTrigger ? (
          <Field label="On">
            <Select
              disabled={busy}
              onValueChange={(value) =>
                onChange({
                  trigger: {
                    ...scheduleTrigger,
                    cron: `${preset.minute} ${preset.hour} * * ${value}`,
                  },
                })
              }
              value={preset.weekday}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{WEEKDAYS[Number(preset.weekday)]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {preset?.frequency === "hourly" && scheduleTrigger ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Every">
              <Select
                disabled={busy}
                onValueChange={(value) =>
                  onChange({
                    trigger: {
                      ...scheduleTrigger,
                      cron: `${preset.minute} ${value === "1" ? "*" : `*/${value}`} * * *`,
                    },
                  })
                }
                value={preset.everyHours}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{hoursLabel(preset.everyHours)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOURLY_INTERVALS.map((hours) => (
                    <SelectItem key={hours} value={hours}>
                      {hoursLabel(hours)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="At minute">
              <Select
                disabled={busy}
                onValueChange={(value) =>
                  onChange({
                    trigger: {
                      ...scheduleTrigger,
                      cron: `${value} ${preset.hour} * * *`,
                    },
                  })
                }
                value={preset.minute}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>:{preset.minute.padStart(2, "0")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 60 }, (_, index) => (
                    <SelectItem key={index} value={String(index)}>
                      :{String(index).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        ) : null}
        {preset?.frequency === "monthly" && scheduleTrigger ? (
          <Field label="Day of the month">
            <Select
              disabled={busy}
              onValueChange={(value) =>
                onChange({
                  trigger: {
                    ...scheduleTrigger,
                    cron: `${preset.minute} ${preset.hour} ${value} * *`,
                  },
                })
              }
              value={preset.day}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{preset.day}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 31 }, (_, index) => (
                  <SelectItem key={index + 1} value={String(index + 1)}>
                    {index + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {frequency === "custom" ? (
          <p className="text-muted-foreground text-sm">
            {automation.trigger.type === "runAt"
              ? `Once, ${automation.trigger.at}`
              : `Custom schedule: ${scheduleTrigger?.cron}`}
          </p>
        ) : null}
      </fieldset>
      <AutomationTimeFields
        automation={automation}
        busy={busy}
        onChange={onChange}
      />
      <AutomationNextRun automation={automation} />
    </>
  );
}

function AutomationNextRun({ automation }: { automation: StoredAutomation }) {
  const { data: userTimezone, isError } = useUserTimezone();

  if (automation.trigger.type === "manual") {
    return null;
  }

  const timezone = automation.trigger.timezone ?? userTimezone;
  let label = "Turned off";

  if (automation.enabled) {
    label = isError ? "Time zone unavailable" : "Loading time zone…";

    if (timezone) {
      label =
        previewAutomationSchedule(automation.trigger, timezone) ??
        "No upcoming run";
    }
  }

  return (
    <p
      aria-live="polite"
      className="rounded-xl bg-muted/40 px-3 py-3 text-muted-foreground text-sm"
    >
      Next run: <span className="font-semibold text-foreground">{label}</span>
    </p>
  );
}

function AutomationTimeFields({
  automation,
  busy,
  onChange,
}: {
  automation: StoredAutomation;
  busy: boolean;
  onChange: (patch: Partial<StoredAutomation>) => void;
}) {
  const preset = readSchedulePreset(automation.trigger);

  const scheduleTrigger =
    automation.trigger.type === "schedule" ? automation.trigger : null;

  const [pickingTime, setPickingTime] = useState(false);

  const timeValue = preset
    ? `${preset.hour.padStart(2, "0")}:${preset.minute.padStart(2, "0")}`
    : "";

  const customTime = preset && !["07:00", "12:00", "18:00"].includes(timeValue);

  function changeTime(value: string) {
    if (!(value && preset && scheduleTrigger)) {
      return;
    }

    const [hour, minute] = value.split(":");

    onChange({
      trigger: {
        ...scheduleTrigger,
        cron: `${Number(minute)} ${Number(hour)} ${preset.day} * ${preset.weekday}`,
      },
    });
  }

  return (
    <>
      {preset && preset.frequency !== "hourly" ? (
        <fieldset className="min-w-0">
          <legend className="mb-2 font-semibold text-sm">What time?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["07:00", "Morning", "7:00 AM"],
                ["12:00", "Midday", "12:00 PM"],
                ["18:00", "Evening", "6:00 PM"],
              ] as const
            ).map(([value, label, time]) => (
              <Button
                aria-label={label}
                aria-pressed={!customTime && timeValue === value}
                className="h-auto min-h-14 flex-col items-start gap-0 rounded-xl px-3 py-2 text-left aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-primary"
                disabled={busy}
                key={value}
                onClick={() => {
                  setPickingTime(false);
                  changeTime(value);
                }}
                type="button"
                variant="outline"
              >
                <span>{label}</span>
                <span className="font-normal text-muted-foreground">
                  {time}
                </span>
              </Button>
            ))}
            <Popover onOpenChange={setPickingTime} open={pickingTime}>
              <PopoverTrigger
                render={
                  <Button
                    aria-label="Pick a time"
                    aria-pressed={Boolean(customTime)}
                    className="h-auto min-h-14 flex-col items-start gap-0 rounded-xl border-dashed px-3 py-2 text-left aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:ring-1 aria-pressed:ring-primary"
                    disabled={busy}
                    type="button"
                    variant="outline"
                  />
                }
              >
                <span>Pick a time</span>
                <span className="font-normal text-muted-foreground">
                  {customTime ? timeValue : "Any time of day"}
                </span>
              </PopoverTrigger>
              <PopoverContent align="end" className="min-w-48 rounded-2xl p-4">
                <PopoverHeader title="Pick a time" />
                <Input
                  aria-label="Run time"
                  className="h-11 rounded-xl tabular-nums"
                  disabled={busy}
                  onChange={(event) => changeTime(event.target.value)}
                  type="time"
                  value={timeValue}
                />
                <Command
                  aria-label="Time options"
                  className="mt-3 h-auto rounded-none! p-0"
                  defaultValue={timeValue}
                  shouldFilter={false}
                  tabIndex={0}
                >
                  <CommandList aria-label="Time options" className="max-h-60">
                    {TIME_OPTIONS.map((option) => (
                      <CommandItem
                        className="min-h-10 rounded-none px-3 tabular-nums"
                        data-checked={option.value === timeValue}
                        disabled={busy}
                        key={option.value}
                        onSelect={() => {
                          changeTime(option.value);
                          setPickingTime(false);
                        }}
                        value={option.value}
                      >
                        {option.label}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </fieldset>
      ) : null}
    </>
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

const AUTOMATION_EXAMPLES = [
  {
    getLines: [
      "Three emails need a reply today",
      "Design review moved to 14:00",
      "One invoice is waiting for approval",
    ],
    getTime: "Weekdays 8:30",
    getTitle: "Today at a glance",
    name: "Morning briefing",
    prompt:
      "Read my unread email and today's calendar. Tell me what needs a reply first.",
    when: "Weekdays at 8:30",
  },
  {
    getLines: [
      "Merged: the new billing page and two fixes",
      "Closed: the older login issues",
      "Still open: the slow export",
    ],
    getTime: "Friday 16:00",
    getTitle: "Report for this week",
    name: "Weekly team report",
    prompt:
      "List the pull requests we merged and the issues we closed this week. Write a short report for the team.",
    when: "Fridays at 16:00",
  },
  {
    getLines: [
      "Competitor A changed its pricing page",
      "Competitor B announced a new integration",
      "No news from Competitor C",
    ],
    getTime: "Monday 9:00",
    getTitle: "What changed this week",
    name: "Competitor watch",
    prompt:
      "Search the web for news about our main competitors. Send me only the changes that matter.",
    when: "Mondays at 9:00",
  },
  {
    getLines: [
      "Two emails need a reply now",
      "Five can wait until later",
      "Eight are safe to ignore",
    ],
    getTime: "Every hour",
    getTitle: "New email, sorted",
    name: "Inbox triage",
    prompt:
      "Sort new email into reply, read later and ignore. Draft a reply for the urgent ones.",
    when: "Every hour",
  },
  {
    getLines: [
      "Changelog is ready",
      "Docs page is not updated yet",
      "Tests pass on main",
    ],
    getTime: "When you run it",
    getTitle: "Before you ship",
    name: "Release checklist",
    prompt:
      "Go through the release checklist. Tell me what is missing before we ship.",
    when: "Manual",
  },
];

export function AutomationExample({
  onUse,
  onStartFromScratch,
}: {
  onUse: (draft: string) => void;
  onStartFromScratch: () => void;
}) {
  const [index, setIndex] = useState(0);
  const example = AUTOMATION_EXAMPLES[index];

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <h2 className="font-semibold text-3xl text-foreground">
        What could your agent do for you?
      </h2>
      <div className="flex flex-wrap justify-center gap-2">
        {AUTOMATION_EXAMPLES.map((item, i) => (
          <button
            aria-pressed={i === index}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              i === index
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground/80 hover:bg-muted"
            )}
            key={item.name}
            onClick={() => setIndex(i)}
            type="button"
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="flex w-full max-w-3xl flex-col items-stretch gap-3 lg:flex-row">
        <div className="flex min-w-0 flex-1 basis-0 flex-col gap-3 rounded-xl border border-border bg-muted/30 p-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              You set
            </span>
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-foreground/80 text-xs">
              {example.when}
            </span>
          </div>
          <p className="font-semibold text-base text-foreground">
            {example.name}
          </p>
          <p className="text-foreground/80 text-sm leading-relaxed">
            {example.prompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-center">
          <ArrowRight01Icon
            aria-hidden
            className="size-5 text-primary max-lg:rotate-90"
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-0 flex-col gap-3 rounded-xl border border-border bg-background p-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-primary text-xs uppercase tracking-wide">
              You get
            </span>
            <span className="text-muted-foreground text-xs">
              {example.getTime}
            </span>
          </div>
          <p className="font-semibold text-base text-foreground">
            {example.getTitle}
          </p>
          <ul className="list-disc space-y-2 pl-5 text-foreground/80 text-sm leading-relaxed marker:text-primary">
            {example.getLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex gap-3">
        <Button
          onClick={() =>
            onUse(
              `Create an automation. Run it: ${example.when}. ${example.prompt}`
            )
          }
          type="button"
        >
          Use this example
        </Button>
        <Button onClick={onStartFromScratch} type="button" variant="outline">
          Start from scratch
        </Button>
      </div>
    </div>
  );
}

function RunHistoryRow({
  run,
  maxDurationMs,
  onSelect,
}: {
  run: AutomationRunRecord;
  maxDurationMs: number;
  onSelect: (runId: string) => void;
}) {
  const durationMs = runDurationMs(run);

  return (
    <li className="flex min-w-0 items-center gap-2 py-3">
      <DialogPrimitive.Trigger
        aria-label={`Open run from ${formatSessionTimestamp(run.startedAt)}`}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
        onClick={() => onSelect(run.id)}
        title={`${runStatusLabel(run.status)} · ${formatSessionTimestamp(run.startedAt)}`}
      >
        {run.status === "running" ? (
          <RunStatusIcon status={run.status} />
        ) : (
          <span
            aria-label={runStatusLabel(run.status)}
            className={cn(
              "size-2 shrink-0 rounded-full",
              run.status === "failed"
                ? "bg-destructive"
                : "bg-emerald-600 dark:bg-emerald-400"
            )}
            role="img"
          />
        )}
        {run.read === false ? (
          <span
            aria-label="Unread"
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        ) : null}
        <span
          className={cn(
            "line-clamp-1 min-w-0 flex-1 text-sm",
            run.status === "failed" ? "text-destructive" : "text-foreground/80"
          )}
        >
          {runPreviewText(run) || runStatusLabel(run.status)}
          {run.deliveryStatus === "failed" ? " · Delivery failed" : ""}
        </span>
        <span className="hidden w-16 shrink-0 text-muted-foreground text-xs sm:block">
          {formatSessionRelativeTime(run.startedAt)}
        </span>
        <span
          aria-hidden
          className="relative hidden h-1.5 w-24 shrink-0 rounded-full bg-muted sm:block"
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              run.status === "failed"
                ? "bg-destructive/40"
                : "bg-muted-foreground/40"
            )}
            style={{
              width: `${Math.max(3, Math.round((durationMs / maxDurationMs) * 100))}%`,
            }}
          />
        </span>
        <span className="w-16 shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs tabular-nums">
          {formatRunDuration(run.startedAt, run.completedAt) ?? ""}
        </span>
      </DialogPrimitive.Trigger>
    </li>
  );
}

function RunStatusBar({
  runs,
  completedCount,
  failedCount,
}: {
  runs: AutomationRunRecord[];
  completedCount: number;
  failedCount: number;
}) {
  return (
    <div
      aria-label={`${completedCount} completed, ${failedCount} failed`}
      className="flex gap-1"
      role="img"
    >
      {runs.map((run) => (
        <span
          className={cn(
            "h-2 min-w-0 flex-1 rounded-full",
            run.status === "failed"
              ? "bg-destructive"
              : run.status === "completed"
                ? "bg-emerald-600 dark:bg-emerald-400"
                : "bg-muted-foreground/40"
          )}
          key={run.id}
        />
      ))}
    </div>
  );
}

function RunDetailPopup({
  selectedRun,
  busy,
  running,
  profileId,
  onRerun,
}: {
  selectedRun: AutomationRunRecord | undefined;
  busy: boolean;
  running: boolean;
  profileId: string;
  onRerun: () => void;
}) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  return (
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
              copiedRunId === selectedRun.id ? "Copied run ID" : "Copy run ID"
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
  );
}

function RunPagination({
  currentPage,
  pageCount,
  pageSize,
  pageStart,
  total,
  onPageChange,
}: {
  currentPage: number;
  pageCount: number;
  pageSize: number;
  pageStart: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Run history pages"
      className="flex items-center justify-between text-muted-foreground text-xs"
    >
      <span className="tabular-nums">
        {pageStart + 1}–{pageStart + pageSize} of {total}
      </span>
      <div className="flex gap-1">
        <Button
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
          size="sm"
          variant="ghost"
        >
          Previous
        </Button>
        <Button
          disabled={currentPage >= pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
          size="sm"
          variant="ghost"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

export function RunHistoryList({
  runs,
  busy,
  running,
  profileId,
  onRerun,
}: {
  runs: AutomationRunRecord[];
  busy: boolean;
  running: boolean;
  profileId: string;
  onRerun: () => void;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const selectedRun = runs.find((run) => run.id === selectedRunId);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(runs.length / RUN_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * RUN_PAGE_SIZE;

  const pageRuns = useMemo(
    () => runs.slice(pageStart, pageStart + RUN_PAGE_SIZE),
    [runs, pageStart]
  );

  const completedCount = runs.filter(
    (run) => run.status === "completed"
  ).length;

  const failedCount = runs.filter((run) => run.status === "failed").length;
  const maxDurationMs = Math.max(1, ...runs.map(runDurationMs));

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
        <RunStatusBar
          completedCount={completedCount}
          failedCount={failedCount}
          runs={runs}
        />
        <div className="flex gap-4 text-muted-foreground text-xs">
          <span>{completedCount} completed</span>
          {failedCount > 0 ? (
            <span className="text-destructive">{failedCount} failed</span>
          ) : null}
        </div>
        <ul className="divide-y divide-border">
          {pageRuns.map((run) => (
            <RunHistoryRow
              key={run.id}
              maxDurationMs={maxDurationMs}
              onSelect={setSelectedRunId}
              run={run}
            />
          ))}
        </ul>
        <RunPagination
          currentPage={currentPage}
          onPageChange={setPage}
          pageCount={pageCount}
          pageSize={pageRuns.length}
          pageStart={pageStart}
          total={runs.length}
        />
      </div>
      <DialogPrimitive.Portal>
        <DialogOverlay className="transition-opacity duration-200 ease-out data-closed:animate-none data-open:animate-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <RunDetailPopup
          busy={busy}
          onRerun={onRerun}
          profileId={profileId}
          running={running}
          selectedRun={selectedRun}
        />
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

const RUN_PAGE_SIZE = 15;

function runDurationMs(run: AutomationRunRecord) {
  if (!run.completedAt) {
    return 0;
  }

  const ms = Date.parse(run.completedAt) - Date.parse(run.startedAt);

  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
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
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 font-semibold text-sm">
        Send me the result on
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {(["none", "telegram", "whatsapp", "email", "discord"] as const).map(
          (value) => (
            <Button
              aria-pressed={channel === value}
              className="min-h-11 rounded-xl aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-primary sm:min-h-10"
              disabled={busy}
              key={value}
              onClick={() => {
                if (value === channel) {
                  return;
                }

                if (value === "none") {
                  onChange(undefined);

                  return;
                }

                const nextDelivery: AutomationDelivery = { channel: value };

                if (value === "email" && delivery?.to) {
                  nextDelivery.to = delivery.to;
                }

                if (value === "discord" && delivery?.channelId) {
                  nextDelivery.channelId = delivery.channelId;
                }

                if (delivery?.notifyOn) {
                  nextDelivery.notifyOn = delivery.notifyOn;
                }

                onChange(nextDelivery);
              }}
              type="button"
              variant="outline"
            >
              {
                {
                  discord: "Discord",
                  email: "Email",
                  none: "Nowhere",
                  telegram: "Telegram",
                  whatsapp: "WhatsApp",
                }[value]
              }
            </Button>
          )
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        Results always stay in the run history.
      </p>

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
    <label className="block min-w-0">
      <span className="mb-1.5 block font-medium text-sm">{label}</span>
      {children}
      {hint ? (
        <p className="mt-1.5 text-pretty text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}
    </label>
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
