import type { SessionSummary } from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useHistorySessionsQuery,
  usePurgeSessionMutation,
} from "@/hooks/use-resource-mutations";
import { resolveHistoryProfileId } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { HistoryDeleteDialog } from "@/pages/history-delete-dialog";
import { HistorySessionsPanel } from "@/pages/history-sessions-panel";

export function HistoryPage() {
  const { navigateToPage, navigateToChat } = useAppNavigation();
  const { activeOrg } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profileId: liveChatProfileId, setProfileId: setLiveChatProfileId } =
    useActiveChatProfile();
  const { data: profiles = [], error: profilesError } = useProfilesQuery();
  const [profileId, setProfileIdState] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const sessionProfileId = profiles.some((profile) => profile.id === profileId)
    ? profileId
    : "";
  const {
    data: sessions = [],
    isLoading: initialLoading,
    isFetching: refreshing,
    error: sessionsError,
    refetch: refetchSessions,
  } = useHistorySessionsQuery(sessionProfileId);
  const purgeMutation = usePurgeSessionMutation();
  const busy = purgeMutation.isPending;
  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;

  const setProfileId = useCallback(
    (nextProfileId: string) => {
      setProfileIdState(nextProfileId);
      setLiveChatProfileId(nextProfileId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextProfileId) {
            next.set("profile", nextProfileId);
          } else {
            next.delete("profile");
          }
          return next;
        },
        { replace: true }
      );
    },
    [setLiveChatProfileId, setSearchParams]
  );

  useEffect(() => {
    const queryError = profilesError ?? sessionsError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, sessionsError]);

  useEffect(() => {
    if (profiles.length === 0) {
      if (profileId) {
        setProfileIdState("");
      }
      return;
    }

    const resolvedProfileId = resolveHistoryProfileId({
      liveChatProfileId,
      orgId: activeOrg?.id,
      profiles,
      search: searchParams.toString(),
    });
    if (resolvedProfileId && resolvedProfileId !== profileId) {
      setError(null);
      setProfileId(resolvedProfileId);
    }
  }, [
    activeOrg?.id,
    liveChatProfileId,
    profileId,
    profiles,
    searchParams,
    setProfileId,
  ]);

  const filteredSessions = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    if (!query) {
      return sessions;
    }

    return sessions.filter((session) => {
      const title = session.title?.trim().toLowerCase() ?? "";
      const preview = session.preview?.trim().toLowerCase() ?? "";
      return (
        title.includes(query) ||
        preview.includes(query) ||
        session.id.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, sessions, trimmedSearch]);

  const countLabel = useMemo(() => {
    if (initialLoading) {
      return "Loading…";
    }

    if (sessions.length === 0) {
      return "No chats";
    }

    if (isSearching && filteredSessions.length !== sessions.length) {
      return `${filteredSessions.length} of ${sessions.length} chats`;
    }

    return `${sessions.length} chat${sessions.length === 1 ? "" : "s"}`;
  }, [filteredSessions.length, initialLoading, isSearching, sessions.length]);

  async function handleDeleteConfirm() {
    if (!(deleteTarget && profileId)) {
      return;
    }

    setError(null);

    try {
      await purgeMutation.mutateAsync({
        channel: deleteTarget.channel,
        profileId,
        sessionId: deleteTarget.id,
      });
      setDeleteTarget(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  function handleOpen(session: SessionSummary) {
    navigateToChat({
      profileId: session.profileId,
      sessionId: session.id,
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <HistorySessionsPanel
          busy={busy}
          countLabel={countLabel}
          filteredSessions={filteredSessions}
          initialLoading={initialLoading}
          onClearSearch={() => setSearchQuery("")}
          onDeleteSession={setDeleteTarget}
          onGoToChat={() => navigateToPage("chat")}
          onGoToProfiles={() => navigateToPage("profiles")}
          onOpenSession={handleOpen}
          onRefresh={() => void refetchSessions()}
          onSearchChange={setSearchQuery}
          profileId={profileId}
          profiles={profiles}
          refreshing={refreshing}
          searchQuery={searchQuery}
          sessions={sessions}
        />
      </section>

      <HistoryDeleteDialog
        busy={busy}
        deleteTarget={deleteTarget}
        onConfirm={() => void handleDeleteConfirm()}
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
