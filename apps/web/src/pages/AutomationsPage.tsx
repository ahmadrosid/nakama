import type {
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationTrigger,
  StoredAutomation,
} from "@tinyclaw/core/contract";
import {
  BotIcon,
  CalendarClockIcon,
  HandIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  useAutomationRunsQuery,
  useAutomationsQuery,
  useDeleteAutomationMutation,
  useRunAutomationMutation,
  useUpdateAutomationMutation,
} from "@/hooks/use-automations";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { formatError } from "@/lib/client";
import { SUPER_BOT_PROFILE_ID } from "@/lib/profiles";
import { formatFutureRelativeTime, formatSessionRelativeTime, formatSessionTimestamp } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

export function AutomationsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const {
    data: automations = [],
    isLoading: initialLoading,
    isFetching: automationsRefreshing,
    error: automationsError,
    refetch: refetchAutomations,
  } = useAutomationsQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    data: runs = [],
    isLoading: runsLoading,
    refetch: refetchRuns,
  } = useAutomationRunsQuery(selectedId);
  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const runMutation = useRunAutomationMutation();
  const [searchQuery, setSearchQuery] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredAutomation | null>(null);
  const [editDraft, setEditDraft] = useState<StoredAutomation | null>(null);

  const busy = updateMutation.isPending || deleteMutation.isPending;
  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;
  const loading = initialLoading && automations.length === 0;
  const refreshing = automationsRefreshing || (runsLoading && Boolean(selectedId));

  const selected = automations.find((automation) => automation.id === selectedId) ?? null;

  const filteredAutomations = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    if (!query) {
      return automations;
    }

    return automations.filter((automation) => {
      return (
        automation.name.toLowerCase().includes(query) ||
        automation.description.toLowerCase().includes(query) ||
        automation.id.toLowerCase().includes(query)
      );
    });
  }, [automations, searchQuery]);

  useEffect(() => {
    if (automationsError) {
      setError(formatError(automationsError));
    }
  }, [automationsError]);

  useEffect(() => {
    if (automations.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !automations.some((automation) => automation.id === selectedId)) {
      setSelectedId(automations[0]!.id);
    }
  }, [automations, selectedId]);

  async function handleSaveEdit() {
    if (!editDraft || busy) {
      return;
    }

    setError(null);

    try {
      await updateMutation.mutateAsync({
        automationId: editDraft.id,
        input: {
          name: editDraft.name,
          description: editDraft.description,
          prompt: editDraft.prompt,
          trigger: editDraft.trigger,
          enabled: editDraft.enabled,
        },
      });
      setEditDraft(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || busy) {
      return;
    }

    setError(null);

    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      if (editDraft?.id === deleteTarget.id) {
        setEditDraft(null);
      }
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleRun(automationId: string) {
    if (busy || runningId) {
      return;
    }

    setRunningId(automationId);
    setError(null);

    try {
      await runMutation.mutateAsync(automationId);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setRunningId(null);
    }
  }

  function openEdit(automation: StoredAutomation) {
    setEditDraft({ ...automation });
  }

  function updateEditDraft(patch: Partial<StoredAutomation>) {
    if (!editDraft) {
      return;
    }

    setEditDraft({ ...editDraft, ...patch });
  }

  async function refresh() {
    setError(null);
    await Promise.all([
      refetchAutomations(),
      selectedId ? refetchRuns() : Promise.resolve(),
    ]);
  }

  function goToCreateAutomation() {
    navigateToNewChat(SUPER_BOT_PROFILE_ID);
  }

  const runScheduleHint = selected
    ? selected.nextRunAt
      ? `Next run ${formatFutureRelativeTime(selected.nextRunAt)}`
      : selected.lastRunAt
        ? `Last run ${formatSessionRelativeTime(selected.lastRunAt)}`
        : "Not run yet"
    : "";

  const selectedSubtitle = selected
    ? [formatTrigger(selected.trigger), selected.enabled ? "enabled" : "disabled", runScheduleHint]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <div className="space-y-4">
        {error ? (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <section className={cn(sectionClass, "overflow-hidden")}>
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:hidden">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={selectedId ?? undefined}
                disabled={busy || refreshing || automations.length === 0}
                onValueChange={(value) => {
                  if (value) {
                    setSelectedId(String(value));
                  }
                }}
              >
                <SelectTrigger className="min-w-0 flex-1" aria-label="Selected automation">
                  <SelectValue placeholder="Select automation" />
                </SelectTrigger>
                <SelectContent>
                  {filteredAutomations.map((automation) => (
                    <SelectItem key={automation.id} value={automation.id}>
                      {automation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || refreshing}
                  aria-label="Refresh automations"
                  onClick={() => void refresh()}
                >
                  {refreshing ? (
                    <Spinner className="size-4" />
                  ) : (
                    <RefreshCwIcon className="size-4" aria-hidden />
                  )}
                </Button>
                <Button type="button" size="sm" onClick={goToCreateAutomation}>
                  <MessageSquareIcon className="size-4" aria-hidden />
                  Create automation
                </Button>
              </div>
            </div>

            {automations.length > 0 ? (
              <AutomationSearch
                value={searchQuery}
                disabled={initialLoading || busy}
                isSearching={isSearching}
                onChange={setSearchQuery}
                onClear={() => setSearchQuery("")}
              />
            ) : null}
          </div>

          <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden min-w-0 border-b border-border lg:block lg:border-r lg:border-b-0">
              <div className="space-y-4 border-b border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                      <BotIcon className="size-5 text-foreground" aria-hidden />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-foreground">Saved</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {automations.length} automation{automations.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy || automationsRefreshing}
                    aria-label="Refresh automations"
                    onClick={() => void refresh()}
                  >
                    {automationsRefreshing ? (
                      <Spinner className="size-4" />
                    ) : (
                      <RefreshCwIcon className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>

                <AutomationSearch
                  value={searchQuery}
                  disabled={initialLoading || automations.length === 0 || busy}
                  isSearching={isSearching}
                  onChange={setSearchQuery}
                  onClear={() => setSearchQuery("")}
                />
              </div>

              <div className="p-2">
                {initialLoading ? (
                  <AutomationListSkeleton />
                ) : automations.length === 0 ? (
                  <AutomationsEmptyState />
                ) : filteredAutomations.length === 0 ? (
                  <div className="px-2 py-10 text-center">
                    <SearchIcon className="mx-auto size-5 text-muted-foreground" aria-hidden />
                    <p className="mt-3 text-sm font-medium text-foreground">No matching automations</p>
                    <p className="mt-1 text-sm text-muted-foreground">Try a different search term.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {filteredAutomations.map((automation) => (
                      <li key={automation.id}>
                        <AutomationListItem
                          automation={automation}
                          selected={selectedId === automation.id}
                          onSelect={() => setSelectedId(automation.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            <div className="min-w-0 p-4 sm:p-5">
              {loading ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Loading automations…
                </div>
              ) : automations.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                  <AutomationsEmptyState />
                  <Button type="button" size="sm" onClick={goToCreateAutomation}>
                    Create automation
                  </Button>
                </div>
              ) : !selected ? (
                <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                  Select an automation to view runs.
                </div>
              ) : (
                <>
                  <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="type-section-title">{selected.name}</h2>
                        {selected.enabled ? (
                          <span className="scope-badge scope-badge-active">enabled</span>
                        ) : (
                          <span className="scope-badge bg-muted text-muted-foreground">disabled</span>
                        )}
                      </div>
                      {selected.description ? (
                        <p className="type-body mt-1 text-sm">{selected.description}</p>
                      ) : null}
                      <p className="type-body mt-1 text-xs">{selectedSubtitle}</p>
                    </div>

                    <div className="hidden shrink-0 flex-wrap items-center gap-2 lg:flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || refreshing}
                        onClick={() => void refresh()}
                      >
                        {refreshing ? (
                          <Spinner className="size-4" />
                        ) : (
                          <RefreshCwIcon className="size-4" aria-hidden />
                        )}
                        Refresh
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || runningId !== null}
                        onClick={() => void handleRun(selected.id)}
                      >
                        {runningId === selected.id ? (
                          <Spinner className="size-4" />
                        ) : (
                          <>
                            <PlayIcon className="size-4" aria-hidden />
                            Run now
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => openEdit(selected)}
                      >
                        <PencilIcon className="size-4" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(selected)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="mb-5 flex flex-wrap gap-2 lg:hidden">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || runningId !== null}
                      onClick={() => void handleRun(selected.id)}
                    >
                      {runningId === selected.id ? (
                        <Spinner className="size-4" />
                      ) : (
                        <>
                          <PlayIcon className="size-4" aria-hidden />
                          Run now
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => openEdit(selected)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(selected)}
                    >
                      Delete
                    </Button>
                  </div>

                  <div className="border-t border-border pt-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="type-section-title">Run history</h3>
                        <p className="type-body mt-1 text-xs">
                          {runsLoading
                            ? "Loading runs…"
                            : runs.length === 0
                              ? "No runs yet"
                              : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
                        </p>
                      </div>
                    </div>

                    {runsLoading ? (
                      <ListSkeleton rows={2} />
                    ) : runs.length === 0 ? (
                      <p className="type-body text-xs">No runs yet.</p>
                    ) : (
                      <ul className="divide-y divide-border rounded-md border border-border">
                        {runs.map((run) => (
                          <RunHistoryItem key={run.id} run={run} />
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
                    <p className="font-medium text-foreground">How it works</p>
                    <p className="mt-2">
                      Run now triggers a manual execution. Scheduled automations run automatically
                      when enabled.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={editDraft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditDraft(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {editDraft ? (
            <>
              <DialogHeader className="gap-2 border-b border-border px-6 py-5">
                <DialogTitle>Edit automation</DialogTitle>
                <DialogDescription>{editDraft.name}</DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <AutomationEditorForm
                  automation={editDraft}
                  busy={busy}
                  onChange={updateEditDraft}
                />
              </div>

              <DialogFooter className="mx-0 mb-0 shrink-0 gap-2 border-t border-border bg-muted/30 px-6 py-5 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditDraft(null)}
                >
                  Cancel
                </Button>
                <Button type="button" disabled={busy} onClick={() => void handleSaveEdit()}>
                  {busy ? <Spinner className="size-4" /> : "Save"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete automation?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>{" "}
              and its run history permanently.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
            >
              {busy ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AutomationListItem({
  automation,
  selected,
  onSelect,
}: {
  automation: StoredAutomation;
  selected: boolean;
  onSelect: () => void;
}) {
  const TriggerIcon = automation.trigger.type === "schedule" ? CalendarClockIcon : HandIcon;

  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition",
        "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "bg-primary/5 ring-1 ring-primary/20",
      )}
      onClick={onSelect}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
        <TriggerIcon className="size-4 text-muted-foreground" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{automation.name}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {formatTrigger(automation.trigger)}
        </p>
        <div className="mt-2">
          <StatusBadge
            label={automation.enabled ? "Enabled" : "Disabled"}
            tone={automation.enabled ? "ok" : "neutral"}
          />
        </div>
      </div>
    </button>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      : "border-border bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}

function AutomationListSkeleton() {
  return (
    <div className="space-y-2 px-2 pb-2" aria-busy="true" aria-label="Loading automations">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 rounded-md px-3 py-3">
          <div className="size-8 animate-pulse rounded-md bg-muted/50" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AutomationSearch({
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

function AutomationEditorForm({
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

function AutomationsEmptyState() {
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

function RunHistoryItem({ run }: { run: AutomationRunRecord }) {
  return (
    <li className="px-4 py-4 first:rounded-t-md last:rounded-b-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className={runStatusClass(run.status)}>{run.status}</span>
        <span className="text-xs text-muted-foreground" title={formatSessionTimestamp(run.startedAt)}>
          {formatSessionRelativeTime(run.startedAt)}
        </span>
      </div>

      {run.output ? (
        <div className="mt-3">
          <MessageResponse>{run.output}</MessageResponse>
        </div>
      ) : null}

      {run.error ? <p className="mt-3 text-sm text-destructive">{run.error}</p> : null}
    </li>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
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

function MetaRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground" title={hint}>
        {value}
      </p>
    </div>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-md bg-muted/40" />
      ))}
    </div>
  );
}

function runStatusClass(status: AutomationRunStatus): string {
  if (status === "completed") {
    return "font-medium text-foreground";
  }

  if (status === "failed") {
    return "font-medium text-destructive";
  }

  return "font-medium text-muted-foreground";
}

function formatTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "manual") {
    return "Manual trigger";
  }

  return `Schedule · ${trigger.cron}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
}

