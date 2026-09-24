import type { BrowserSessionSummary } from "@nakama/core/contract";
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
      await queryClient.invalidateQueries({
        queryKey: queryKeys.browserSessions,
      });
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
