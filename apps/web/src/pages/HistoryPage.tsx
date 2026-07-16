import type { SessionSummary } from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { usePurgeSessionMutation, useHistorySessionsQuery } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { HistoryDeleteDialog } from "@/pages/history-delete-dialog";
import {
  HistoryPageShell,
  HistoryProfileSidebar,
  HistorySessionsPanel,
} from "@/pages/history-page-sections";

export function HistoryPage() {
  const { navigateToPage, navigateToChat } = useAppNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
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
    [setSearchParams],
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
    const fromUrl = searchParams.get("profile");
    const matchedProfile = fromUrl ? profiles.find((profile) => profile.id === fromUrl) : null;
    const defaultProfile =
      matchedProfile ??
      profiles.find((profile) => profile.id === "default") ??
      profiles[0]!;

    setProfileId(defaultProfile.id);
  }, [profiles, searchParams, setProfileId]);

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
      return "No saved chats";
    }

    if (isSearching && filteredSessions.length !== sessions.length) {
      return `${filteredSessions.length} of ${sessions.length}`;
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

      <HistoryPageShell>
        <HistoryProfileSidebar
          profiles={profiles}
          profileId={profileId}
          busy={busy}
          onProfileSelect={setProfileId}
          onGoToProfiles={() => navigateToPage("profiles")}
        />

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
      </HistoryPageShell>

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
