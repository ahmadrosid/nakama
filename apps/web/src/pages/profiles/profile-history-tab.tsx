import type { ProfileChangeEvent } from "@nakama/core";
import { useQuery } from "@tanstack/react-query";
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
    return <p className="text-muted-foreground text-sm">Loading history…</p>;
  }

  if (error) {
    return (
      <p className="text-destructive text-sm">
        {formatError(error)}{" "}
        <button
          className="underline underline-offset-2"
          onClick={() => void refetch()}
          type="button"
        >
          Retry
        </button>
      </p>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No profile changes yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="type-section-title">History</h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {events.map((event) => (
          <li className="space-y-2 px-3 py-3" key={event.id}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">
                {formatFieldLabel(event.field)}
              </span>
              <span className="text-muted-foreground">
                {formatSourceLabel(event.source)}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {new Date(event.createdAt).toLocaleString()}
              </span>
              {event.actorUserId ? (
                <span className="text-muted-foreground text-xs">
                  {event.actorUserId}
                </span>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                <p className="mb-1 text-muted-foreground text-xs">Before</p>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  {previewValue(event.beforeValue)}
                </pre>
              </div>
              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                <p className="mb-1 text-muted-foreground text-xs">After</p>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  {previewValue(event.afterValue)}
                </pre>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
