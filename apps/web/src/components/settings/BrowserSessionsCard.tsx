import type {
  BrowserSessionSummary,
  ComputerSummary,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  formatFutureRelativeTime,
  formatSessionRelativeTime,
} from "@/lib/chat-history";
import { client, formatError } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

function describeSession(session: BrowserSessionSummary): string {
  const used = session.lastUsedAt
    ? `Last used ${formatSessionRelativeTime(session.lastUsedAt)}`
    : `Signed in ${formatSessionRelativeTime(session.createdAt)}`;

  return `${used} · expires ${formatFutureRelativeTime(session.expiresAt)}`;
}

export function BrowserSessionsCard() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryFn: () => client.listBrowserSessions(),
    queryKey: queryKeys.browserSessions,
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => client.revokeBrowserSession(sessionId),
    onError: (mutationError) => setError(formatError(mutationError)),
    onSuccess: async () => {
      setError(null);
      await invalidateQueries(queryClient, queryKeys.browserSessions);
    },
  });

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              Active sessions
            </p>
            <p className="text-muted-foreground text-xs">
              Browsers currently signed in to your account. Sign out of one you
              do not recognise.
            </p>
            {error ? (
              <p className="text-destructive text-xs" role="status">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        {sessionsQuery.isLoading ? (
          <div className="px-4 py-3">
            <Spinner />
          </div>
        ) : null}

        {sessionsQuery.isError ? (
          <p className="px-4 py-3 text-destructive text-xs">
            {formatError(sessionsQuery.error)}
          </p>
        ) : null}

        {sessions.map((session) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            key={session.id}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="text-foreground text-sm">
                {session.current ? "This browser" : "Another browser"}
              </p>
              <p className="text-muted-foreground text-xs">
                {describeSession(session)}
              </p>
            </div>
            {session.current ? null : (
              <Button
                aria-label="Sign out this session"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                Sign out
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function describeComputer(computer: ComputerSummary): string {
  return computer.lastSeenAt
    ? `Last used ${formatSessionRelativeTime(computer.lastSeenAt)}`
    : `Connected ${formatSessionRelativeTime(computer.createdAt)}`;
}

/** Computers that run Nakama Desktop with this account. Same shape as sessions. */
export function ComputersCard() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const computersQuery = useQuery({
    queryFn: () => client.listComputers(),
    queryKey: queryKeys.computers,
  });

  const remove = useMutation({
    mutationFn: (computerId: string) => client.removeComputer(computerId),
    onError: (mutationError) => setError(formatError(mutationError)),
    onSuccess: async () => {
      setError(null);
      await invalidateQueries(queryClient, queryKeys.computers);
    },
  });

  const computers = computersQuery.data?.computers ?? [];

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="space-y-0.5 px-4 py-3">
          <p className="font-medium text-foreground text-sm">Computers</p>
          {error ? (
            <p className="text-destructive text-xs" role="status">
              {error}
            </p>
          ) : null}
        </div>

        {computersQuery.isLoading ? (
          <div className="px-4 py-3">
            <Spinner />
          </div>
        ) : null}

        {computersQuery.isError ? (
          <p className="px-4 py-3 text-destructive text-xs">
            {formatError(computersQuery.error)}
          </p>
        ) : null}

        {computersQuery.isSuccess && computers.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            No computers
          </p>
        ) : null}

        {computers.map((computer) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            key={computer.id}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="text-foreground text-sm">{computer.name}</p>
              <p className="text-muted-foreground text-xs">
                {describeComputer(computer)}
              </p>
            </div>
            <Button
              aria-label={`Remove ${computer.name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(computer.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Remove
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** On Nakama Desktop: the Nakama Cloud account whose models this computer uses. */
export function NakamaCloudCard() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryFn: () => client.getNakamaCloudStatus(),
    queryKey: queryKeys.nakamaCloud,
    retry: false,
  });

  const signOut = useMutation({
    mutationFn: () => client.signOutNakamaCloud(),
    onError: (mutationError) => setError(formatError(mutationError)),
    onSuccess: async () => {
      setError(null);
      await invalidateQueries(queryClient, queryKeys.nakamaCloud);
    },
  });

  const status = statusQuery.data;

  if (!status?.signedIn) {
    return null;
  }

  const who = [status.account, status.orgName].filter(Boolean).join(" · ");

  return (
    <Card className="w-full shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">
            Signed in to Nakama Cloud
          </p>
          <p className="text-muted-foreground text-xs">{who}</p>
          {error ? (
            <p className="text-destructive text-xs" role="status">
              {error}
            </p>
          ) : null}
        </div>
        <Button
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
          size="sm"
          type="button"
          variant="outline"
        >
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}
