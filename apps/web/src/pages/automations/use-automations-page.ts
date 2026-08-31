import type {
  AutomationRunRecord,
  StoredAutomation,
} from "@nakama/core/contract";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useAutomationRunsQuery,
  useAutomationsQuery,
  useDeleteAutomationMutation,
  useDeleteAutomationRunMutation,
  useMarkAutomationRunsReadMutation,
  useRunAutomationMutation,
  useUpdateAutomationMutation,
} from "@/hooks/use-automations";
import {
  formatFutureRelativeTime,
  formatSessionRelativeTime,
} from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { findSuperBotProfile } from "@/lib/profiles";
import { formatTrigger } from "@/pages/automations/automations-page.shared";

const EMPTY_AUTOMATIONS: StoredAutomation[] = [];
const EMPTY_UNREAD_BY_AUTOMATION_ID: Record<string, number> = {};

export function useAutomationsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const {
    data: automationsData,
    isLoading: initialLoading,
    isFetching: automationsRefreshing,
    error: automationsError,
    refetch: refetchAutomations,
  } = useAutomationsQuery();
  const automations = automationsData?.automations ?? EMPTY_AUTOMATIONS;
  const unreadByAutomationId =
    automationsData?.unread?.byAutomationId ?? EMPTY_UNREAD_BY_AUTOMATION_ID;
  const { data: profiles = [], isLoading: profilesLoading } =
    useProfilesQuery();
  const superBotProfile = findSuperBotProfile(profiles);
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    data: runs = [],
    isLoading: runsLoading,
    isSuccess: runsLoaded,
    refetch: refetchRuns,
  } = useAutomationRunsQuery(selectedId);
  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const deleteRunMutation = useDeleteAutomationRunMutation();
  const runMutation = useRunAutomationMutation();
  const markReadMutation = useMarkAutomationRunsReadMutation();
  const [searchQuery, setSearchQuery] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredAutomation | null>(
    null
  );
  const [deleteRunTarget, setDeleteRunTarget] =
    useState<AutomationRunRecord | null>(null);
  const [editDraft, setEditDraft] = useState<StoredAutomation | null>(null);

  const busy =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    deleteRunMutation.isPending;
  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;
  const loading = initialLoading && automations.length === 0;
  const refreshing =
    automationsRefreshing || (runsLoading && Boolean(selectedId));

  const selected =
    automations.find((automation) => automation.id === selectedId) ?? null;

  const filteredAutomations = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    return automations.filter(
      (automation) =>
        !query ||
        automation.name.toLowerCase().includes(query) ||
        automation.description.toLowerCase().includes(query) ||
        automation.id.toLowerCase().includes(query)
    );
  }, [automations, trimmedSearch]);

  const selectedRunSummary = useMemo(() => {
    const completed = runs.filter((run) => run.status === "completed").length;
    const failed = runs.filter((run) => run.status === "failed").length;
    const running = runs.filter((run) => run.status === "running").length;
    const unread = runs.filter((run) => run.read === false).length;
    return { completed, failed, running, unread };
  }, [runs]);

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

    const automationFromUrl = searchParams.get("automation");
    if (
      automationFromUrl &&
      automations.some((automation) => automation.id === automationFromUrl)
    ) {
      setSelectedId(automationFromUrl);
      return;
    }

    if (
      !(
        selectedId &&
        automations.some((automation) => automation.id === selectedId)
      )
    ) {
      setSelectedId(automations[0]!.id);
    }
  }, [automations, selectedId, searchParams]);

  useEffect(() => {
    if (!(selectedId && runsLoaded)) {
      return;
    }

    const hasUnreadRuns = runs.some((run) => run.read === false);
    const hasListUnread = (unreadByAutomationId[selectedId] ?? 0) > 0;
    if (!(hasUnreadRuns || hasListUnread)) {
      return;
    }

    void markReadMutation.mutate(selectedId);
  }, [
    runs,
    runsLoaded,
    selectedId,
    unreadByAutomationId,
    markReadMutation.mutate,
  ]);

  async function handleSaveEdit() {
    if (!editDraft || busy) {
      return;
    }

    setError(null);

    try {
      await updateMutation.mutateAsync({
        automationId: editDraft.id,
        input: {
          delivery: editDraft.delivery ?? null,
          description: editDraft.description,
          enabled: editDraft.enabled,
          name: editDraft.name,
          profileId: editDraft.profileId,
          prompt: editDraft.prompt,
          trigger: editDraft.trigger,
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

  async function handleDeleteRunConfirm() {
    if (!(selectedId && deleteRunTarget) || busy) {
      return;
    }

    setError(null);

    try {
      await deleteRunMutation.mutateAsync({
        automationId: selectedId,
        runId: deleteRunTarget.id,
      });
      setDeleteRunTarget(null);
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
    ? [
        profiles.find((p) => p.id === selected.profileId)?.name ??
          selected.profileId,
        formatTrigger(selected.trigger),
        runScheduleHint,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return {
    automations,
    automationsRefreshing,
    busy,
    deleteRunTarget,
    deleteTarget,
    editDraft,
    error,
    filteredAutomations,
    goToCreateAutomation,
    handleDeleteConfirm,
    handleDeleteRunConfirm,
    handleRun,
    handleSaveEdit,
    initialLoading,
    isSearching,
    loading,
    openEdit,
    profiles,
    profilesLoading,
    refresh,
    refreshing,
    runningId,
    runs,
    runsLoading,
    searchQuery,
    selected,
    selectedId,
    selectedRunSummary,
    selectedSubtitle,
    setDeleteRunTarget,
    setDeleteTarget,
    setEditDraft,
    setSearchQuery,
    setSelectedId,
    trimmedSearch,
    unreadByAutomationId,
    updateEditDraft,
  };
}

export type AutomationsPageState = ReturnType<typeof useAutomationsPage>;
