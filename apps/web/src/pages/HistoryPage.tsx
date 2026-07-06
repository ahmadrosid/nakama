import type { SessionSummary } from "@nakama/core/contract";
import { RefreshCwIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
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
import { Spinner } from "@/components/ui/spinner";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { usePurgeSessionMutation, useHistorySessionsQuery } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import {
  formatSessionChannelLabel,
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import { useAppNavigation } from "@/hooks/use-app-navigation";

const sectionClass = "rounded-md border border-border bg-card";

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

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions],
  );

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

      <section className={cn(sectionClass, "overflow-hidden")}>
        <div className="grid min-h-[100vh] lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="h-full border-b border-border p-4 lg:border-r lg:border-b-0">
            <div className="space-y-3">
              <div>
                <h2 className="type-section-title">Profiles</h2>
                <p className="mt-1 text-xs text-muted-foreground">Choose which chat history to view.</p>
              </div>

              {profiles.length === 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToPage("profiles")}
                >
                  Go to Profiles
                </Button>
              ) : (
                <div className="space-y-1">
                  {profiles.map((profile) => {
                    const active = profile.id === profileId;

                    return (
                      <button
                        key={profile.id}
                        type="button"
                        disabled={busy}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                          active
                            ? "border-foreground/15 bg-muted text-foreground"
                            : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
                        )}
                        onClick={() => setProfileId(profile.id)}
                      >
                        <ProfileAvatar profile={profile} size="xs" />
                        <span className="truncate">{profile.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
              <div className="relative min-w-0 flex-1">
                <SearchIcon
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search…"
                  disabled={!profileId || initialLoading}
                  className={cn("pl-9", isSearching && "pr-9")}
                  aria-label="Search conversations"
                />
                {isSearching ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <XIcon className="size-4" />
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">{countLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={refreshing || busy || !profileId}
                  aria-label="Refresh"
                  onClick={() => void refetchSessions()}
                >
                  {refreshing ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
                </Button>
              </div>
            </div>

            {profiles.length === 0 ? (
              <EmptyMessage
                message="Create a profile first."
                actionLabel="Go to Profiles"
                onAction={() => navigateToPage("profiles")}
              />
            ) : initialLoading ? (
              <ListSkeleton />
            ) : filteredSessions.length === 0 ? (
              <EmptyMessage
                message={
                  sessions.length > 0
                    ? "No conversations match your search."
                    : "No saved chats for this profile."
                }
                actionLabel={sessions.length > 0 ? "Clear search" : "Go to Chat"}
                onAction={() =>
                  sessions.length > 0 ? setSearchQuery("") : navigateToPage("chat")
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {groupedSessions.map((group) => (
                  <section key={group.label}>
                    <p className="px-4 py-2 text-xs text-muted-foreground">{group.label}</p>
                    <ul>
                      {group.sessions.map((session) => (
                        <li key={session.id}>
                          <SessionRow
                            session={session}
                            disabled={busy}
                            onOpen={() => handleOpen(session)}
                            onDelete={() => setDeleteTarget(session)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

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
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This removes {deleteTarget?.messageCount ?? 0} message
              {(deleteTarget?.messageCount ?? 0) === 1 ? "" : "s"}. This cannot be undone.
            </DialogDescription>
            {deleteTarget ? (
              <p className="text-sm font-medium text-foreground line-clamp-2">
                {formatSessionTitle(deleteTarget)}
              </p>
            ) : null}
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
    </div>
  );
}

function SessionRow({
  session,
  disabled,
  onOpen,
  onDelete,
}: {
  session: SessionSummary;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = formatSessionTitle(session);

  return (
    <div className="group flex items-center gap-2 px-4 py-3 hover:bg-muted/40">
      <button
        type="button"
        disabled={disabled}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
        onClick={onOpen}
      >
        <p className="truncate text-sm text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {session.channel !== "web" ? (
            <>
              <span>{formatSessionChannelLabel(session.channel)}</span>
              {" · "}
            </>
          ) : null}
          <time dateTime={session.updatedAt} title={formatSessionTimestamp(session.updatedAt)}>
            {formatSessionRelativeTime(session.updatedAt)}
          </time>
          {" · "}
          {session.messageCount} messages
        </p>
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={`Delete ${title}`}
        className="shrink-0 text-muted-foreground/60 hover:text-destructive"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

function formatSessionTitle(session: SessionSummary): string {
  return session.title?.trim() || "Untitled";
}

function EmptyMessage({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border" aria-busy="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-2 px-4 py-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}

function groupSessionsByDate(sessions: SessionSummary[]): Array<{
  label: string;
  sessions: SessionSummary[];
}> {
  const order = ["Today", "Yesterday", "This week", "Earlier"] as const;
  const buckets = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const label = getDateGroupLabel(session.updatedAt);
    const existing = buckets.get(label) ?? [];
    existing.push(session);
    buckets.set(label, existing);
  }

  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({
      label,
      sessions: buckets.get(label)!,
    }));
}

function getDateGroupLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDay >= startOfToday) {
    return "Today";
  }

  if (sessionDay >= startOfYesterday) {
    return "Yesterday";
  }

  if (sessionDay >= startOfWeek) {
    return "This week";
  }

  return "Earlier";
}
