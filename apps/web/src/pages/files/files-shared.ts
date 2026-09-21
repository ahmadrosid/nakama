import type { ArtifactFile } from "@nakama/core/contract";
import { createContext } from "react";
import type { ChatArtifactRef } from "@/lib/chat-artifacts";
import { client } from "@/lib/client";

/** Extend icon-sm (28px) to a 40px hit target without overlapping neighbors at gap-3. */
export const iconActionHitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

export function toChatArtifactRef(artifact: ArtifactFile): ChatArtifactRef {
  return {
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    path: artifact.path || artifact.filename,
    savedAt: artifact.updatedAt,
    sizeBytes: artifact.sizeBytes,
  };
}

export function getArtifactDownloadUrl(
  profileId: string,
  filename: string
): string {
  const query = new URLSearchParams({ path: filename });
  return `${client.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`;
}

export const FilePinsContext = createContext<{
  paths: Set<string>;
  pending: boolean;
  toggle: (path: string, pinned: boolean) => void;
} | null>(null);

export const FileRenameContext = createContext<((path: string) => void) | null>(
  null
);
