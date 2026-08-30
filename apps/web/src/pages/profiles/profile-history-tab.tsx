import type { ProfileChangeEvent } from "@nakama/core";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

function formatFieldLabel(field: ProfileChangeEvent["field"]): string {
  switch (field) {
    case "system_prompt":
      return "System prompt";
    case "soul.soul":
      return "SOUL.md";
    case "soul.style":
      return "STYLE.md";
    case "soul.instructions":
      return "INSTRUCTIONS.md";
    case "soul.memory":
      return "MEMORY.md";
    case "tools":
      return "Tools";
    case "skills":
      return "Skills";
    case "mcp":
      return "MCP";
    case "pack_import":
      return "Pack import";
    default:
      return field;
  }
}

function formatSourceLabel(source: ProfileChangeEvent["source"]): string {
  switch (source) {
    case "dashboard":
      return "Dashboard";
    case "super_bot":
      return "Super Bot";
    case "skill_manage":
      return "skill_manage";
    case "pack_import":
      return "Pack import";
    default:
      return source;
  }
}

function formatActorLabel(actorUserId: string): string {
  return actorUserId.length > 16 ? `${actorUserId.slice(0, 12)}…` : actorUserId;
}

function previewValue(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "(empty)";
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

export function ProfileHistoryTab({ profileId }: { profileId: string }) {
  const { data, error, isLoading, refetch } = useQuery({
    queryFn: () => client.listProfileChangeHistory(profileId, { limit: 100 }),
    queryKey: queryKeys.profiles.history(profileId),
  });

  if (isLoading) {
    return (
      <p className="text-pretty text-muted-foreground text-sm">
        Loading history…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-pretty text-destructive text-sm">
        {formatError(error)}{" "}
        <Button
          className="relative h-auto p-0 after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2"
          onClick={() => void refetch()}
          type="button"
          variant="link"
        >
          Retry
        </Button>
      </p>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-pretty text-muted-foreground text-sm">
        No profile changes yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="type-section-title text-balance">History</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {events.map((event) => {
          const actor = event.actorUserId
            ? formatActorLabel(event.actorUserId)
            : null;

          return (
            <li className="space-y-2 px-4 py-3" key={event.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm">
                  <span className="font-medium">
                    {formatFieldLabel(event.field)}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {formatSourceLabel(event.source)}
                  </span>
                </p>
                <p className="shrink-0 text-muted-foreground text-xs">
                  <time
                    className="tabular-nums"
                    dateTime={event.createdAt}
                    title={formatSessionTimestamp(event.createdAt)}
                  >
                    {formatSessionRelativeTime(event.createdAt)}
                  </time>
                  {actor ? <> · {actor}</> : null}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-sm bg-muted/40 px-2 py-1.5">
                  <p className="mb-1 text-muted-foreground text-xs">Before</p>
                  <pre className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {previewValue(event.beforeValue)}
                  </pre>
                </div>
                <div className="rounded-sm bg-muted/40 px-2 py-1.5">
                  <p className="mb-1 text-muted-foreground text-xs">After</p>
                  <pre className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {previewValue(event.afterValue)}
                  </pre>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
