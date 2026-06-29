import type {
  AutomationDelivery,
  AutomationDeliveryChannel,
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationTrigger,
  StoredAutomation,
} from "@tinyclaw/core/contract";
import {
  BotIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CopyIcon,
  HandIcon,
  Loader2Icon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XCircleIcon,
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
  useMarkAutomationRunsReadMutation,
  useRunAutomationMutation,
  useUpdateAutomationMutation,
} from "@/hooks/use-automations";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { findSuperBotProfile } from "@/lib/profiles";
import { formatFutureRelativeTime, formatSessionRelativeTime, formatSessionTimestamp } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

/** Stable shell height inside the scrollable main area (header + padding). */
const automationsShellMinHeight = "min-h-96 md:min-h-[calc(100dvh-11rem)]";
const runHistoryScrollClass =
  "min-h-[14rem] flex-1 overflow-y-auto overscroll-contain lg:min-h-[18rem]";

export function AutomationsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const {
    data: automationsData,
    isLoading: initialLoading,
    isFetching: automationsRefreshing,
    error: automationsError,
    refetch: refetchAutomations,
  } = useAutomationsQuery();
  const automations = automationsData?.automations ?? [];
  const unreadByAutomationId = automationsData?.unread?.byAutomationId ?? {};
  const { data: profiles = [] } = useProfilesQuery();
  const superBotProfile = findSuperBotProfile(profiles);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    data: runs = [],
    isLoading: runsLoading,
    isSuccess: runsLoaded,
    refetch: refetchRuns,
  } = useAutomationRunsQuery(selectedId);
  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const runMutation = useRunAutomationMutation();
  const markReadMutation = useMarkAutomationRunsReadMutation();
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

  useEffect(() => {
    if (!selectedId || !runsLoaded) {
      return;
    }

    const hasUnreadRuns = runs.some((run) => run.read === false);
    const hasListUnread = (unreadByAutomationId[selectedId] ?? 0) > 0;
    if (!hasUnreadRuns && !hasListUnread) {
      return;
    }

    void markReadMutation.mutate(selectedId);
  }, [runs, runsLoaded, selectedId, unreadByAutomationId, markReadMutation.mutate]);

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
          delivery: editDraft.delivery ?? null,
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
    if (!superBotProfile) {
      setError("No super bot profile exists in this organization.");
      return;
    }

    navigateToNewChat(superBotProfile.id);
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
      <div className="flex min-h-full flex-col gap-4">
        {error ? (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <section
          className={cn(
            sectionClass,
            automationsShellMinHeight,
            "flex flex-col overflow-hidden",
          )}
        >
          <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4 lg:hidden">
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
                      {(unreadByAutomationId[automation.id] ?? 0) > 0
                        ? ` (${unreadByAutomationId[automation.id]})`
                        : ""}
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

            <AutomationSearch
              value={searchQuery}
              disabled={initialLoading || automations.length === 0 || busy}
              isSearching={isSearching}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery("")}
            />
          </div>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden min-h-0 min-w-0 flex-col border-b border-border lg:flex lg:border-r lg:border-b-0">
              <div className="shrink-0 space-y-3 border-b border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {automations.length} automation{automations.length === 1 ? "" : "s"}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy || automationsRefreshing}
                    aria-label="Refresh automations"
                    onClick={() => void refresh()}
                  >
                    {automationsRefreshing ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <RefreshCwIcon className="size-3.5" aria-hidden />
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

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {initialLoading ? (
                  <AutomationListSkeleton />
                ) : automations.length === 0 ? (
                  <div className="flex min-h-[12rem] items-center justify-center">
                    <AutomationsEmptyState />
                  </div>
                ) : filteredAutomations.length === 0 ? (
                  <div className="flex min-h-[12rem] flex-col items-center justify-center px-2 py-10 text-center">
                    <SearchIcon className="size-5 text-muted-foreground" aria-hidden />
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
                          unreadCount={unreadByAutomationId[automation.id] ?? 0}
                          onSelect={() => setSelectedId(automation.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-5">
              {loading ? (
                <AutomationDetailSkeleton />
              ) : automations.length === 0 ? (
                <AutomationPanelPlaceholder>
                  <AutomationsEmptyState />
                  <Button type="button" size="sm" onClick={goToCreateAutomation}>
                    Create automation
                  </Button>
                </AutomationPanelPlaceholder>
              ) : !selected ? (
                <AutomationPanelPlaceholder>
                  Select an automation to view runs.
                </AutomationPanelPlaceholder>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-h-[4.75rem] min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="type-section-title">{selected.name}</h2>
                        {selected.enabled ? (
                          <span className="scope-badge scope-badge-active">enabled</span>
                        ) : (
                          <span className="scope-badge bg-muted text-muted-foreground">disabled</span>
                        )}
                      </div>
                      <p
                        className={cn(
                          "type-body mt-1 line-clamp-2 min-h-[2.5rem] text-sm",
                          selected.description ? "text-foreground" : "text-transparent",
                        )}
                      >
                        {selected.description || "No description"}
                      </p>
                      <p className="type-body mt-1 text-xs">{selectedSubtitle}</p>
                    </div>

                    <AutomationDetailActions
                      automation={selected}
                      busy={busy}
                      runningId={runningId}
                      onRun={handleRun}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                      className="hidden lg:flex"
                    />
                  </div>

                  <AutomationDetailActions
                    automation={selected}
                    busy={busy}
                    runningId={runningId}
                    onRun={handleRun}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                    className="mb-5 lg:hidden"
                  />

                  <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-5">
                    <div className="mb-4 flex h-10 shrink-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="type-section-title">Run history</h3>
                        <p className="type-body mt-1 min-h-[1rem] text-xs">
                          {runsLoading
                            ? "Loading runs…"
                            : runs.length === 0
                              ? "No runs yet"
                              : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        disabled={runsLoading || busy}
                        aria-label="Refresh run history"
                        onClick={() => void refetchRuns()}
                      >
                        {runsLoading ? (
                          <Spinner className="size-4" />
                        ) : (
                          <RefreshCwIcon className="size-4" aria-hidden />
                        )}
                      </Button>
                    </div>

                    <div className={runHistoryScrollClass}>
                      {runsLoading ? (
                        <ListSkeleton rows={3} />
                      ) : runs.length === 0 ? (
                        <div className="flex min-h-[10rem] items-center justify-center">
                          <p className="type-body text-xs text-muted-foreground">No runs yet.</p>
                        </div>
                      ) : (
                        <RunHistoryList runs={runs} />
                      )}
                    </div>
                  </div>

                  <div className="type-body mt-5 shrink-0 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
                    <p className="font-medium text-foreground">How it works</p>
                    <p className="mt-2">
                      Run now triggers a manual execution. Scheduled automations run automatically
                      when enabled.
                    </p>
                  </div>
                </div>
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

function AutomationDetailActions({
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
        variant="outline"
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
        variant="outline"
        size="icon-sm"
        disabled={busy}
        aria-label="Edit"
        onClick={() => onEdit(automation)}
      >
        <PencilIcon className="size-3.5" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
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

function AutomationListItem({
  automation,
  selected,
  unreadCount,
  onSelect,
}: {
  automation: StoredAutomation;
  selected: boolean;
  unreadCount: number;
  onSelect: () => void;
}) {
  const TriggerIcon =
    automation.trigger.type === "schedule" || automation.trigger.type === "runAt"
      ? CalendarClockIcon
      : HandIcon;

  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40",
        selected && "bg-muted/40",
      )}
      onClick={onSelect}
    >
      <TriggerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />

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
          {formatTrigger(automation.trigger)}
        </p>
        <p
          className={cn(
            "text-xs font-medium",
            automation.enabled
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-muted-foreground",
          )}
        >
          {automation.enabled ? "Enabled" : "Disabled"}
        </p>
      </div>
    </button>
  );
}

function AutomationListSkeleton() {
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

function AutomationPanelPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      {children}
    </div>
  );
}

function AutomationDetailSkeleton() {
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
        <div className={runHistoryScrollClass}>
          <ListSkeleton rows={3} />
        </div>
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

function RunHistoryList({ runs }: { runs: AutomationRunRecord[] }) {
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

  return (
    <ul className="space-y-2">
      {runs.map((run) => (
        <RunHistoryItem
          key={run.id}
          run={run}
          expanded={expandedId === run.id}
          onToggle={() => {
            setExpandedId((current) => (current === run.id ? null : run.id));
          }}
        />
      ))}
    </ul>
  );
}

function RunHistoryItem({
  run,
  expanded,
  onToggle,
}: {
  run: AutomationRunRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = run.status === "running";
  const isUnread = run.read === false;
  const hasOutput = Boolean(run.output?.trim());
  const hasError = Boolean(run.error?.trim());
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
          "overflow-hidden rounded-md border bg-card shadow-sm transition-shadow",
          runHistoryShellClass(run.status),
        )}
      >
        <button
          type="button"
          className={cn(
            "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
            hasBody && "hover:bg-muted/40",
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
              {isUnread ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  New
                </span>
              ) : null}
              {run.deliveryStatus ? (
                <>
                  <span className="text-xs text-muted-foreground" aria-hidden>
                    ·
                  </span>
                  <DeliveryStatusBadge status={run.deliveryStatus} error={run.deliveryError} />
                </>
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
                  "line-clamp-2 text-sm leading-relaxed",
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

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            expanded && hasBody ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border px-3 py-3">
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

function RunStatusIcon({ status }: { status: AutomationRunStatus }) {
  const className = "mt-0.5 size-4 shrink-0";

  if (status === "completed") {
    return <CheckCircle2Icon className={cn(className, "text-emerald-600 dark:text-emerald-400")} aria-hidden />;
  }

  if (status === "failed") {
    return <XCircleIcon className={cn(className, "text-destructive")} aria-hidden />;
  }

  return <Loader2Icon className={cn(className, "animate-spin text-muted-foreground")} aria-hidden />;
}

function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  return (
    <span
      className={cn(
        "text-xs font-medium capitalize",
        status === "completed" && "text-emerald-700 dark:text-emerald-300",
        status === "failed" && "text-destructive",
        status === "running" && "text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function runHistoryShellClass(_status: AutomationRunStatus): string {
  return "border-border";
}

function runPreviewText(run: AutomationRunRecord): string | null {
  if (run.status === "running" && !run.output?.trim() && !run.error?.trim()) {
    return "Run in progress…";
  }

  if (run.status === "failed" && run.error?.trim()) {
    return run.error.trim();
  }

  const source = run.output?.trim() || run.error?.trim();

  if (!source) {
    return null;
  }

  const plain = source
    .split("\n")
    .map((line) => stripMarkdownForPreview(line))
    .filter(Boolean)
    .join(" ");

  return truncatePlainText(plain, 200);
}

function stripMarkdownForPreview(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function truncatePlainText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function formatRunDuration(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) {
    return null;
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }

  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
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

function DeliveryStatusBadge({
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

function formatTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "manual") {
    return "Manual trigger";
  }

  if (trigger.type === "runAt") {
    return `One-time · ${trigger.at}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
  }

  return `Schedule · ${trigger.cron}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
}

