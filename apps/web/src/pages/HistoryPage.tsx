import type { SessionSummary } from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { usePurgeSessionMutation, useHistorySessionsQuery } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { resolveHistoryProfileId } from "@/lib/chat-history";
import { HistoryDeleteDialog } from "@/pages/history-delete-dialog";
import { HistorySessionsPanel } from "@/pages/history-sessions-panel";

export function HistoryPage() {
  const { navigateToPage, navigateToChat } = useAppNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profileId: liveChatProfileId, setProfileId: setLiveChatProfileId } =
    useActiveChatProfile();
  const { data: profiles = [], error: profilesError } = useProfilesQuery();
  const [profileId, setProfileIdState] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const profileInitializedRef = useRef(false);
  const {
    data: sessions = [],
    isLoading: initialLoading,
    isFetching: refreshing,
    error: sessionsError,
    refetch: refetchSessions,
  } = useHistorySessionsQuery(profileId);
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
        { replace: true },
      );
    },
    [setLiveChatProfileId, setSearchParams],
  );

  useEffect(() => {
    const queryError = profilesError ?? sessionsError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, sessionsError]);

  useEffect(() => {
    if (profiles.length === 0 || profileInitializedRef.current) {
      return;
    }

    profileInitializedRef.current = true;
    const resolvedProfileId = resolveHistoryProfileId({
      search: searchParams.toString(),
      profiles,
      liveChatProfileId,
    });
    if (resolvedProfileId) {
      setProfileId(resolvedProfileId);
    }
  }, [liveChatProfileId, profiles, searchParams, setProfileId]);

  // Sync from URL when the profile rail switches the active profile after init.
  useEffect(() => {
    if (!profileInitializedRef.current) {
      return;
    }
    const fromUrl = searchParams.get("profile");
    if (!fromUrl || fromUrl === profileId) {
      return;
    }
    if (profiles.some((profile) => profile.id === fromUrl)) {
      setProfileId(fromUrl);
    }
  }, [searchParams, profileId, profiles, setProfileId]);

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
    if (!deleteTarget || !profileId) {
      return;
    }

    setError(null);

    try {
      await purgeMutation.mutateAsync({
        profileId,
        sessionId: deleteTarget.id,
        channel: deleteTarget.channel,
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
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <HistorySessionsPanel
          profiles={profiles}
          profileId={profileId}
          searchQuery={searchQuery}
          countLabel={countLabel}
          refreshing={refreshing}
          busy={busy}
          initialLoading={initialLoading}
          sessions={sessions}
          filteredSessions={filteredSessions}
          onSearchChange={setSearchQuery}
          onClearSearch={() => setSearchQuery("")}
          onRefresh={() => void refetchSessions()}
          onGoToProfiles={() => navigateToPage("profiles")}
          onGoToChat={() => navigateToPage("chat")}
          onOpenSession={handleOpen}
          onDeleteSession={setDeleteTarget}
        />
      </section>

      <HistoryDeleteDialog
        deleteTarget={deleteTarget}
        busy={busy}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </div>
  );
}
