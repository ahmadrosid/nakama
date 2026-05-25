import type { ProfileSummary, SessionSummary } from "@tinyclaw/core/contract";
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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { client, formatError } from "@/lib/client";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
  type RequestedChatSession,
} from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import type { PageId } from "@/lib/navigation";

interface HistoryPageProps {
  onNavigate: (page: PageId) => void;
  onOpenSession: (session: RequestedChatSession) => void;
}

export function HistoryPage({ onNavigate, onOpenSession }: HistoryPageProps) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return sessions;
    }

    return sessions.filter((session) => {
      const preview = session.preview?.trim().toLowerCase() ?? "";
      return preview.includes(query) || session.id.toLowerCase().includes(query);
    });
  }, [searchQuery, sessions]);

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions],
  );

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);

      if (!profileId && response.profiles.length > 0) {
        const defaultProfile =
          response.profiles.find((profile) => profile.id === "profile_default") ??
          response.profiles[0]!;
        setProfileId(defaultProfile.id);
      }
    } catch (err) {
      setError(formatError(err));
    }
  }, [profileId]);

  const loadSessions = useCallback(async (nextProfileId: string, options?: { silent?: boolean }) => {
    if (!nextProfileId) {
      setSessions([]);
      setInitialLoading(false);
      return;
    }

    const silent = options?.silent ?? false;
    if (!silent) {
      setRefreshing(true);
    }
    setError(null);

    try {
      const response = await client.listSessions(nextProfileId, "web");
      setSessions(response.sessions);
    } catch (err) {
      setError(formatError(err));
      setSessions([]);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (profileId) {
      setInitialLoading(true);
      void loadSessions(profileId);
    }
  }, [profileId, loadSessions]);

  async function handleDeleteConfirm() {
    if (!deleteTarget) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const chatSession = client.createChatSession(deleteTarget.id, "web");
      await chatSession.purge();
      setDeleteTarget(null);
      await loadSessions(profileId, { silent: true });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleOpen(session: SessionSummary) {
    onOpenSession({
      profileId: session.profileId,
      sessionId: session.id,
    });
    onNavigate("chat");
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
              <UserIcon className="size-5 text-foreground" aria-hidden />
            </div>
            <div>
              <CardTitle>Profile</CardTitle>
              <CardDescription className="mt-1">
                Choose which bot profile&apos;s saved chats to browse.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="label" htmlFor="history-profile">
              Active profile
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
                    {profile.name}
                    {profile.isSuper ? " (super)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="button" className="w-full" onClick={() => onNavigate("chat")}>
            <MessageSquareIcon aria-hidden />
            Back to Chat
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {activeProfile ? activeProfile.name : "Saved sessions"}
            </p>
            <p className="text-sm text-muted-foreground">
              {activeProfile
                ? `${sessions.length} saved web chat${sessions.length === 1 ? "" : "s"}`
                : "Select a profile to view sessions."}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || busy || !profileId}
            aria-label="Refresh session list"
            onClick={() => void loadSessions(profileId)}
          >
            {refreshing ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCwIcon className="size-4" aria-hidden />
            )}
            Refresh
          </Button>
        </div>

        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search conversations…"
            disabled={!profileId || initialLoading}
            className="pl-9"
            aria-label="Search saved conversations"
          />
        </div>

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
                    onClick={() => void loadSessions(profileId)}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="p-0">
            {initialLoading ? (
              <HistoryListSkeleton />
            ) : filteredSessions.length === 0 ? (
              <HistoryEmptyState
                hasSessions={sessions.length > 0}
                onStartChat={() => onNavigate("chat")}
              />
            ) : (
              <div className="divide-y divide-border">
                {groupedSessions.map((group) => (
                  <section key={group.label}>
                    <div className="flex items-center gap-2 bg-muted/30 px-4 py-2.5">
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
      </div>

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
    <div className="group flex items-stretch gap-1 px-2 py-1 sm:px-3">
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-3 text-left transition",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        onClick={onOpen}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <MessagesSquareIcon className="size-4 text-muted-foreground" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span title={formatSessionTimestamp(session.updatedAt)}>
              {formatSessionRelativeTime(session.updatedAt)}
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{session.messageCount} messages</span>
          </div>
        </div>

        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 motion-reduce:opacity-100"
          aria-hidden
        />
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={`Delete ${title}`}
        className="my-auto shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

function HistoryEmptyState({
  hasSessions,
  onStartChat,
}: {
  hasSessions: boolean;
  onStartChat: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40">
        {hasSessions ? (
          <SearchIcon className="size-5 text-muted-foreground" aria-hidden />
        ) : (
          <HistoryIcon className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="type-section-title">
          {hasSessions ? "No matching conversations" : "No saved chats yet"}
        </h3>
        <p className="type-body max-w-sm text-muted-foreground">
          {hasSessions
            ? "Try a different search term or clear the filter."
            : "Start a conversation in Chat and it will appear here for this profile."}
        </p>
      </div>

      {!hasSessions ? (
        <Button type="button" onClick={onStartChat}>
          <MessageSquareIcon aria-hidden />
          Go to Chat
        </Button>
      ) : null}
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
