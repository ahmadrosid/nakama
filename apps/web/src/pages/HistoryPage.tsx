import type { SessionSummary } from "@tinyclaw/core/contract";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  ClockIcon,
  HistoryIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { usePurgeSessionMutation, useSessionsQuery } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import { useAppNavigation } from "@/hooks/use-app-navigation";

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
  } = useSessionsQuery(profileId);
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
      profiles.find((profile) => profile.id === "profile_default") ??
      profiles[0]!;

    setProfileId(defaultProfile.id);
  }, [profiles, searchParams, setProfileId]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );

  const filteredSessions = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    if (!query) {
      return sessions;
    }

    return sessions.filter((session) => {
      const preview = session.preview?.trim().toLowerCase() ?? "";
      return preview.includes(query) || session.id.toLowerCase().includes(query);
    });
  }, [sessions, trimmedSearch]);

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions],
  );

  const sessionCountLabel = useMemo(() => {
    if (!profileId) {
      return "Select a profile to browse saved chats.";
    }

    if (initialLoading) {
      return "Loading saved chats…";
    }

    if (sessions.length === 0) {
      return "No saved chats for this profile yet.";
    }

    if (isSearching && filteredSessions.length !== sessions.length) {
      return `${filteredSessions.length} of ${sessions.length} conversation${
        sessions.length === 1 ? "" : "s"
      } match your search`;
    }

    return `${sessions.length} saved chat${sessions.length === 1 ? "" : "s"}`;
  }, [filteredSessions.length, initialLoading, isSearching, profileId, sessions.length]);

  async function handleDeleteConfirm() {
    if (!deleteTarget || !profileId) {
      return;
    }

    setError(null);

    try {
      await purgeMutation.mutateAsync({
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
        <Card className="border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <AlertTriangleIcon
              className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-red-900 dark:text-red-100">
                Could not load chat history
              </p>
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              {profileId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-300 bg-white text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60"
                  onClick={() => void refetchSessions()}
                >
                  Try again
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                <HistoryIcon className="size-5 text-foreground" aria-hidden />
              </div>
              <div className="min-w-0">
                <CardTitle>Saved chats</CardTitle>
                <CardDescription className="mt-1">{sessionCountLabel}</CardDescription>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={refreshing || busy || !profileId}
              aria-label="Refresh session list"
              className="shrink-0"
              onClick={() => void refetchSessions()}
            >
              {refreshing ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCwIcon className="size-4" aria-hidden />
              )}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="label" htmlFor="history-profile">
                Profile
              </label>
              <Select
                value={profileId}
                disabled={busy || profiles.length === 0}
                onValueChange={(value) => setProfileId(value != null ? String(value) : "")}
              >
                <SelectTrigger id="history-profile" className="w-full">
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      <span className="flex items-center gap-2">
                        <ProfileAvatar profile={profile} size="sm" />
                        <span>
                          {profile.name}
                          {profile.isSuper ? " (super)" : ""}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="label" htmlFor="history-search">
                Search
              </label>
              <div className="relative">
                <SearchIcon
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="history-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by preview or ID…"
                  disabled={!profileId || initialLoading}
                  className={cn("pl-9", isSearching && "pr-9")}
                  aria-label="Search saved conversations"
                />
                {isSearching ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear search"
                    className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <XIcon className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {refreshing && !initialLoading ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Updating list…
            </p>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          {profiles.length === 0 ? (
            <HistoryEmptyState
              variant="no-profiles"
              onPrimaryAction={() => navigateToPage("profiles")}
            />
          ) : initialLoading ? (
            <HistoryListSkeleton />
          ) : filteredSessions.length === 0 ? (
            <HistoryEmptyState
              variant={sessions.length > 0 ? "no-results" : "no-sessions"}
              profileName={activeProfile?.name}
              onPrimaryAction={() => navigateToPage("chat")}
              onClearSearch={() => setSearchQuery("")}
            />
          ) : (
            <div
              className={cn(
                "divide-y divide-border transition-opacity duration-200",
                refreshing && !initialLoading && "opacity-70",
              )}
            >
              {groupedSessions.map((group) => (
                <section key={group.label} aria-labelledby={`history-group-${group.label}`}>
                  <div
                    id={`history-group-${group.label}`}
                    className="flex items-center gap-2 bg-muted/30 px-4 py-2.5"
                  >
                    <ClockIcon className="size-3.5 text-muted-foreground" aria-hidden />
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {group.label}
                    </h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ({group.sessions.length})
                    </span>
                  </div>

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
        </CardContent>
      </Card>

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
              This permanently removes{" "}
              <span className="font-medium text-foreground tabular-nums">
                {deleteTarget?.messageCount ?? 0}
              </span>{" "}
              message{(deleteTarget?.messageCount ?? 0) === 1 ? "" : "s"} from SQLite. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteTarget?.preview?.trim() ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
              <p className="line-clamp-2">{deleteTarget.preview.trim()}</p>
            </div>
          ) : null}

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
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
              {busy ? <Spinner className="size-4" /> : <Trash2Icon aria-hidden />}
              Delete
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
  const title = session.preview?.trim() || "Untitled conversation";

  return (
    <div className="flex items-stretch gap-1 px-2 py-1 sm:px-3">
      <button
        type="button"
        disabled={disabled}
        aria-label={`Open conversation: ${title}`}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-left transition-colors duration-200",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        onClick={onOpen}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <MessagesSquareIcon className="size-4 text-muted-foreground" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-foreground">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <time dateTime={session.updatedAt} title={formatSessionTimestamp(session.updatedAt)}>
              {formatSessionRelativeTime(session.updatedAt)}
            </time>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{session.messageCount} messages</span>
          </div>
        </div>

        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`Delete ${title}`}
        className="my-auto size-11 shrink-0 text-muted-foreground hover:text-destructive"
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

function HistoryEmptyState({
  variant,
  profileName,
  onPrimaryAction,
  onClearSearch,
}: {
  variant: "no-profiles" | "no-sessions" | "no-results";
  profileName?: string;
  onPrimaryAction: () => void;
  onClearSearch?: () => void;
}) {
  const icon =
    variant === "no-results" ? (
      <SearchIcon className="size-5 text-muted-foreground" aria-hidden />
    ) : (
      <HistoryIcon className="size-5 text-muted-foreground" aria-hidden />
    );

  const title =
    variant === "no-profiles"
      ? "No profiles yet"
      : variant === "no-results"
        ? "No matching conversations"
        : "No saved chats yet";

  const description =
    variant === "no-profiles"
      ? "Create a profile first, then start chatting to build history."
      : variant === "no-results"
        ? "Try a shorter keyword, check spelling, or clear the filter."
        : profileName
          ? `Start a conversation with ${profileName} in Chat and it will appear here.`
          : "Start a conversation in Chat and it will appear here for this profile.";

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40">
        {icon}
      </div>

      <div className="space-y-1.5">
        <h3 className="type-section-title">{title}</h3>
        <p className="type-body max-w-sm text-muted-foreground">{description}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {variant === "no-results" && onClearSearch ? (
          <Button type="button" variant="outline" onClick={onClearSearch}>
            Clear search
          </Button>
        ) : null}
        {variant !== "no-results" ? (
          <Button type="button" onClick={onPrimaryAction}>
            {variant === "no-profiles" ? (
              <UserIcon aria-hidden />
            ) : (
              <MessageSquareIcon aria-hidden />
            )}
            {variant === "no-profiles" ? "Go to Profiles" : "Go to Chat"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function HistoryListSkeleton() {
  return (
    <div className="space-y-0 divide-y divide-border" aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4">
          <div className="size-9 animate-pulse rounded-md bg-muted/50" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
          </div>
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
