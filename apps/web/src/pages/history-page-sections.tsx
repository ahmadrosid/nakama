import type { ProfileSummary, SessionSummary } from "@nakama/core/contract";
import { RefreshCwIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  formatSessionChannelLabel,
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import { formatSessionTitle, groupSessionsByDate } from "@/pages/history-page.shared";

const sectionClass = "rounded-md border border-border bg-card";

export function HistoryProfileSidebar({
  profiles,
  profileId,
  busy,
  onProfileSelect,
  onGoToProfiles,
}: {
  profiles: ProfileSummary[];
  profileId: string;
  busy: boolean;
  onProfileSelect: (profileId: string) => void;
  onGoToProfiles: () => void;
}) {
  return (
    <aside className="h-full border-b border-border p-4 lg:border-r lg:border-b-0">
      <div className="space-y-3">
        <div>
          <h2 className="type-section-title">Profiles</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose which chat history to view.</p>
        </div>

        {profiles.length === 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={onGoToProfiles}>
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
                  onClick={() => onProfileSelect(profile.id)}
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
  );
}

export function HistorySessionsPanel({
  profiles,
  profileId,
  searchQuery,
  countLabel,
  refreshing,
  busy,
  initialLoading,
  sessions,
  filteredSessions,
  onSearchChange,
  onClearSearch,
  onRefresh,
  onGoToProfiles,
  onGoToChat,
  onOpenSession,
  onDeleteSession,
}: {
  profiles: ProfileSummary[];
  profileId: string;
  searchQuery: string;
  countLabel: string;
  refreshing: boolean;
  busy: boolean;
  initialLoading: boolean;
  sessions: SessionSummary[];
  filteredSessions: SessionSummary[];
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onRefresh: () => void;
  onGoToProfiles: () => void;
  onGoToChat: () => void;
  onOpenSession: (session: SessionSummary) => void;
  onDeleteSession: (session: SessionSummary) => void;
}) {
  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;
  const groupedSessions = groupSessionsByDate(filteredSessions);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
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
              onClick={onClearSearch}
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
            onClick={onRefresh}
          >
            {refreshing ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
          </Button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <HistoryEmptyMessage
          message="Create a profile first."
          actionLabel="Go to Profiles"
          onAction={onGoToProfiles}
        />
      ) : initialLoading ? (
        <HistoryListSkeleton />
      ) : filteredSessions.length === 0 ? (
        <HistoryEmptyMessage
          message={
            sessions.length > 0
              ? "No conversations match your search."
              : "No saved chats for this profile."
          }
          actionLabel={sessions.length > 0 ? "Clear search" : "Go to Chat"}
          onAction={() => (sessions.length > 0 ? onClearSearch() : onGoToChat())}
        />
      ) : (
        <div className="divide-y divide-border">
          {groupedSessions.map((group) => (
            <section key={group.label}>
              <p className="px-4 py-2 text-xs text-muted-foreground">{group.label}</p>
              <ul>
                {group.sessions.map((session) => (
                  <li key={session.id}>
                    <HistorySessionRow
                      session={session}
                      disabled={busy}
                      onOpen={() => onOpenSession(session)}
                      onDelete={() => onDeleteSession(session)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryPageShell({ children }: { children: React.ReactNode }) {
  return (
    <section className={cn(sectionClass, "overflow-hidden")}>
      <div className="grid min-h-[100vh] lg:grid-cols-[240px_minmax(0,1fr)]">{children}</div>
    </section>
  );
}

function HistorySessionRow({
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

function HistoryEmptyMessage({
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

function HistoryListSkeleton() {
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
