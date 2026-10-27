import type { AgentGroupMemoryChange } from "@nakama/core/agent-groups";
import { cn } from "@nakama/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  File01Icon,
} from "hugeicons-react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import { useArtifactsExist } from "@/hooks/use-resource-mutations";
import { sharedFileMentions, withPanel } from "@/lib/agent-group-panels";
import {
  type ChatArtifactRef,
  extractArtifactPathsFromText,
  inferArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";

/** Memory lines are saved as markdown list items; the notice shows the text. */
function memoryLineText(entry: string) {
  return entry.replace(/^\s*[-*]\s+/, "");
}

function memoryChangeSummary(changes: AgentGroupMemoryChange[]) {
  const added = changes.filter((change) => change.oldEntry === null).length;
  const removed = changes.filter((change) => change.newEntry === null).length;
  const changed = changes.length - added - removed;

  return [
    added ? `${added} added` : null,
    changed ? `${changed} changed` : null,
    removed ? `${removed} removed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Completed writes stay with the reply, even if memory changes again later. */
export function GroupMessageMemoryChanges({
  changes,
}: {
  changes?: AgentGroupMemoryChange[];
}) {
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  if (!changes?.length) {
    return null;
  }

  // The same write can repeat in one message; count repeats for a stable key.
  const seen = new Map<string, number>();

  const shown = (open ? changes : changes.slice(0, 1)).map((change) => {
    const base = `${change.oldEntry}\u0000${change.newEntry}`;
    const count = (seen.get(base) ?? 0) + 1;

    seen.set(base, count);

    return { change, key: `${base}\u0000${count}` };
  });

  const canExpand = changes.length > 1;
  const summary = memoryChangeSummary(changes);

  return (
    <div className="w-72 max-w-full overflow-hidden rounded-[1.25rem] bg-muted text-sm">
      <ol className="flex flex-col gap-1 bg-background/50 p-1.5">
        {shown.map(({ change, key }) => (
          <li key={key}>
            <button
              className="group/row flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                setSearchParams(
                  (current) => withPanel(current, "memory", "1"),
                  {
                    replace: true,
                    state: { groupMemoryEntry: change.newEntry },
                  }
                )
              }
              title="Open in Memory"
              type="button"
            >
              {change.oldEntry === null ? (
                <span
                  aria-label="Added"
                  className="w-2.5 shrink-0 font-semibold text-blue-600 dark:text-blue-400"
                >
                  +
                </span>
              ) : change.newEntry === null ? (
                <span
                  aria-label="Removed"
                  className="w-2.5 shrink-0 font-semibold text-orange-700 dark:text-orange-300"
                >
                  −
                </span>
              ) : (
                <span
                  aria-label="Changed"
                  className="w-2.5 shrink-0 font-semibold text-muted-foreground"
                >
                  ~
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 break-words">
                {change.oldEntry === null ? null : (
                  <s className="text-muted-foreground">
                    {memoryLineText(change.oldEntry)}
                  </s>
                )}
                {change.newEntry === null ? null : (
                  <span>{memoryLineText(change.newEntry)}</span>
                )}
              </span>
              <ArrowUpRight01Icon
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
              />
            </button>
          </li>
        ))}
      </ol>
      {canExpand ? (
        <button
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">Group memory</span>
            <span className="text-muted-foreground text-xs">{summary}</span>
          </span>
          <ArrowDown01Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      ) : (
        <div className="flex flex-col px-3.5 py-2">
          <span className="font-semibold">Group memory</span>
          <span className="text-muted-foreground text-xs">{summary}</span>
        </div>
      )}
    </div>
  );
}

/** One line: file icon, name and type, as its own bubble. */
function ArtifactPill({
  artifact,
  id,
  profileId,
}: {
  artifact: ChatArtifactRef;
  id: string;
  profileId: string;
}) {
  const { openPanel } = useArtifactAttachmentPreviewPanel({
    artifact,
    id,
    profileId: artifact.ownerProfileId ?? profileId,
  });

  const type = artifact.filename.split(".").pop()?.toUpperCase();

  return (
    <button
      className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={openPanel}
      type="button"
    >
      <File01Icon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate font-medium">{artifact.filename}</span>
      {type ? (
        <span className="shrink-0 text-muted-foreground text-xs">{type}</span>
      ) : null}
      <ArrowUpRight01Icon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

/** A file in the group's shared folder; opens it in the Files panel. */
function SharedFilePill({ path }: { path: string }) {
  const [, setSearchParams] = useSearchParams();
  const filename = path.split("/").pop() ?? path;

  const type = filename.includes(".")
    ? filename.split(".").pop()?.toUpperCase()
    : undefined;

  return (
    <button
      className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        setSearchParams((current) => withPanel(current, "files", path), {
          replace: true,
        })
      }
      type="button"
    >
      <File01Icon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate font-medium">{filename}</span>
      {type ? (
        <span className="shrink-0 text-muted-foreground text-xs">{type}</span>
      ) : null}
      <ArrowUpRight01Icon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

/** An image the user pasted; opens it in the Files panel. */
export function GroupMessageImage({ path }: { path: string }) {
  const { groupId = "" } = useParams();
  const [, setSearchParams] = useSearchParams();
  const [url, setUrl] = useState<string | null>(null);

  const { data } = useQuery({
    queryFn: () => client.readAgentGroupFile(groupId, path),
    queryKey: ["agentGroups", groupId, "image", path],
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    const next = URL.createObjectURL(data);
    setUrl(next);

    return () => URL.revokeObjectURL(next);
  }, [data]);

  return (
    <button
      className="block overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        setSearchParams((current) => withPanel(current, "files", path), {
          replace: true,
        })
      }
      type="button"
    >
      {url ? (
        <img
          alt={path.split("/").pop() ?? path}
          className="max-h-64 max-w-full object-contain"
          height={256}
          src={url}
          width={256}
        />
      ) : (
        <div className="size-40 animate-pulse bg-muted" />
      )}
    </button>
  );
}

/** Chips for the `artifacts/...` and `shared/...` files an agent names in its message. */
export function GroupMessageArtifacts({
  content,
  messageId,
  profileId,
}: {
  content: string;
  messageId: number;
  profileId: string;
}) {
  const artifacts = useMemo<ChatArtifactRef[]>(
    () =>
      extractArtifactPathsFromText(content).map(({ ownerProfileId, path }) => {
        const filename = path.split("/").pop() ?? path;

        return {
          filename,
          mimeType: inferArtifactMimeType(filename),
          ownerProfileId,
          path,
          savedAt: "",
          sizeBytes: 0,
        };
      }),
    [content]
  );

  const exists = useArtifactsExist(artifacts, profileId, messageId > 0);
  const live = artifacts.filter((_, index) => exists[index]);
  const shared = useMemo(() => sharedFileMentions(content), [content]);

  if (live.length === 0 && shared.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      {shared.map((path) => (
        <SharedFilePill key={`shared:${path}`} path={path} />
      ))}
      {live.map((artifact) => {
        const id = `group:${messageId}:${artifact.ownerProfileId ?? profileId}:${artifact.path}`;

        return (
          <ArtifactPill
            artifact={artifact}
            id={id}
            key={id}
            profileId={profileId}
          />
        );
      })}
    </div>
  );
}
