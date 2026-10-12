import uFuzzy from "@leeoniya/ufuzzy";
import type { StoredAutomation } from "@nakama/core/contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useAutomationRunsQuery,
  useAutomationsQuery,
  useDeleteAutomationMutation,
  useMarkAutomationRunsReadMutation,
  useRunAutomationMutation,
  useUpdateAutomationMutation,
} from "@/hooks/use-automations";
import { formatError } from "@/lib/client";
import { findSuperBotProfile } from "@/lib/profiles";

const EMPTY_AUTOMATIONS: StoredAutomation[] = [];

const EMPTY_UNREAD_BY_AUTOMATION_ID: Record<string, number> = {};

const automationSearch = new uFuzzy({
  compare: () => 0,
  intraIns: Number.POSITIVE_INFINITY,
});

export function useAutomationsPage() {
  const { navigateToNewChat } = useAppNavigation();
  const { profileId } = useActiveChatProfile();

  const {
    data: automationsData,
    isLoading: initialLoading,
    isFetching: automationsRefreshing,
    error: automationsError,
    refetch: refetchAutomations,
  } = useAutomationsQuery(5000);

  const unreadByAutomationId =
    automationsData?.unread?.byAutomationId ?? EMPTY_UNREAD_BY_AUTOMATION_ID;

  const { data: profiles = [], isLoading: profilesLoading } =
    useProfilesQuery();

  const superBotProfile = findSuperBotProfile(profiles);

  const automations = useMemo(() => {
    const all = automationsData?.automations ?? EMPTY_AUTOMATIONS;

    return profileId && profileId === superBotProfile?.id
      ? all
      : all.filter((automation) => automation.profileId === profileId);
  }, [automationsData?.automations, profileId, superBotProfile?.id]);

  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: runs = [],
    dataUpdatedAt: runsUpdatedAt,
    isLoading: runsLoading,
    isSuccess: runsLoaded,
    refetch: refetchRuns,
  } = useAutomationRunsQuery(selectedId);

  const updateMutation = useUpdateAutomationMutation();
  const deleteMutation = useDeleteAutomationMutation();
  const runMutation = useRunAutomationMutation();
  const markReadMutation = useMarkAutomationRunsReadMutation();
  const markingRead = useRef(new Set<string>());
  const [searchQuery, setSearchQuery] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<StoredAutomation | null>(
    null
  );

  const [editDraft, setEditDraft] = useState<StoredAutomation | null>(null);

  const busy = updateMutation.isPending || deleteMutation.isPending;

  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;
  const loading = initialLoading && automations.length === 0;

  const refreshing =
    automationsRefreshing || (runsLoading && Boolean(selectedId));

  const selected =
    automations.find((automation) => automation.id === selectedId) ?? null;

  const filteredAutomations = useMemo(() => {
    const query = trimmedSearch.trim().toLowerCase();

    if (!query) {
      return automations;
    }

    const [indices, info, order] = automationSearch.search(
      automations.map((automation) =>
        [automation.name, automation.description, automation.id].join(" ")
      ),
      query
    );

    const matches =
      info && order ? order.map((index) => info.idx[index]) : indices;

    return (matches ?? []).map((index) => automations[index]!);
  }, [automations, trimmedSearch]);

  const selectedRunSummary = useMemo(() => {
    const completed = runs.filter((run) => run.status === "completed").length;
    const failed = runs.filter((run) => run.status === "failed").length;
    const running = runs.filter((run) => run.status === "running").length;
    const unread = runs.filter((run) => run.read === false).length;

    return { completed, failed, running, unread };
  }, [runs]);

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
    if (!(selectedId && runsLoaded) || markingRead.current.has(selectedId)) {
      return;
    }

    const hasUnreadRuns = runs.some((run) => run.read === false);

    if (!hasUnreadRuns) {
      return;
    }

    // Keep the guard through invalidation, while cached runs can still be unread.
    markingRead.current.add(selectedId);
    void markReadMutation.mutateAsync(selectedId).then(
      () => markingRead.current.delete(selectedId),
      () => markingRead.current.delete(selectedId)
    );
  }, [
    runs,
    runsLoaded,
    runsUpdatedAt,
    selectedId,
    markReadMutation.mutateAsync,
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

  async function handleToggleEnabled(
    automation: StoredAutomation,
    enabled: boolean
  ) {
    if (busy) {
      return;
    }

    setError(null);

    try {
      await updateMutation.mutateAsync({
        automationId: automation.id,
        input: {
          delivery: automation.delivery ?? null,
          description: automation.description,
          enabled,
          name: automation.name,
          profileId: automation.profileId,
          prompt: automation.prompt,
          trigger: automation.trigger,
        },
      });
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

  function goToCreateAutomation(draft?: string) {
    if (draft && profileId) {
      navigateToNewChat(profileId, { draft });

      return;
    }

    if (!superBotProfile) {
      setError("No super bot profile exists in this organization.");

      return;
    }

    navigateToNewChat(superBotProfile.id, { draft });
  }

  const selectedProfileName = selected
    ? (profiles.find((p) => p.id === selected.profileId)?.name ??
      selected.profileId)
    : "";

  return {
    automations,
    automationsRefreshing,
    busy,
    deleteTarget,
    editDraft,
    error: error ?? (automationsError ? formatError(automationsError) : null),
    filteredAutomations,
    goToCreateAutomation,
    handleDeleteConfirm,
    handleRun,
    handleSaveEdit,
    handleToggleEnabled,
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
    selectedProfileName,
    selectedRunSummary,
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
