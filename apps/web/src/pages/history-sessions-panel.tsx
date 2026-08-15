import type { ProfileSummary, SessionSummary } from "@nakama/core/contract";
import {
  Cancel01Icon,
  Delete02Icon,
  RefreshIcon,
  Search01Icon,
} from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  formatSessionChannelLabel,
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import {
  formatSessionTitle,
  groupSessionsByDate,
} from "@/pages/history-page.shared";

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
      <div className="flex flex-wrap items-center gap-3 border-border border-b p-4">
        <div className="relative min-w-0 flex-1">
          <Search01Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search chats"
            className={cn("pl-9", isSearching && "pr-9")}
            disabled={!profileId || initialLoading}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search chats…"
            value={searchQuery}
          />
          {isSearching ? (
            <button
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={onClearSearch}
              type="button"
            >
              <Cancel01Icon className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {countLabel}
          </span>
          <Button
            aria-label="Refresh chats"
            disabled={refreshing || busy || !profileId}
            onClick={onRefresh}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {refreshing ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshIcon className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <HistoryEmptyMessage
          actionLabel="Go to Profiles"
          message="Create a profile to start chatting."
          onAction={onGoToProfiles}
        />
      ) : initialLoading ? (
        <HistoryListSkeleton />
      ) : filteredSessions.length === 0 ? (
        <HistoryEmptyMessage
          actionLabel={sessions.length > 0 ? "Clear search" : "New chat"}
          message={
            sessions.length > 0
              ? "No chats match your search."
              : "No chats yet."
          }
          onAction={() =>
            sessions.length > 0 ? onClearSearch() : onGoToChat()
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {groupedSessions.map((group) => (
            <section key={group.label}>
              <p className="px-4 py-2 font-medium text-muted-foreground text-xs">
                {group.label}
              </p>
              <ul>
                {group.sessions.map((session) => (
                  <li key={session.id}>
                    <HistorySessionRow
                      disabled={busy}
                      onDelete={() => onDeleteSession(session)}
                      onOpen={() => onOpenSession(session)}
                      session={session}
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

function formatMessageCount(count: number): string {
  return count === 1 ? "1 message" : `${count} messages`;
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
    <div className="group flex items-center gap-2 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/40">
      <button
        className="min-w-0 flex-1 text-left disabled:opacity-50"
        disabled={disabled}
        onClick={onOpen}
        type="button"
      >
        <p className="truncate font-medium text-foreground text-sm">{title}</p>
        <p className="mt-0.5 text-pretty text-muted-foreground text-xs">
          {session.channel === "web" ? null : (
            <>
              <span>{formatSessionChannelLabel(session.channel)}</span>
              {" · "}
            </>
          )}
          <time
            dateTime={session.updatedAt}
            title={formatSessionTimestamp(session.updatedAt)}
          >
            {formatSessionRelativeTime(session.updatedAt)}
          </time>
          {" · "}
          <span className="tabular-nums">
            {formatMessageCount(session.messageCount)}
          </span>
        </p>
      </button>

      <Button
        aria-label={`Delete ${title}`}
        className="shrink-0 text-muted-foreground hover:text-destructive"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Delete02Icon className="size-4" />
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
      <p className="text-pretty text-muted-foreground text-sm">{message}</p>
      {actionLabel && onAction ? (
        <Button
          className="mt-2 h-auto p-0"
          onClick={onAction}
          type="button"
          variant="link"
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function HistoryListSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading chats"
      className="divide-y divide-border"
    >
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="space-y-2 px-4 py-3" key={index}>
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}
