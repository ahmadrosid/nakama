import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight01Icon, File01Icon } from "hugeicons-react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import { useArtifactsExist } from "@/hooks/use-resource-mutations";
import { sharedFileMentions, withPanel } from "@/lib/agent-group-pending";
import {
  type ChatArtifactRef,
  extractArtifactPathsFromText,
  inferArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";

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
