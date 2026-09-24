import type { ProfileSummary } from "@nakama/core/contract";
import {
  pickKnownProfileId,
  resolveDefaultProfileId,
} from "@/lib/chat-history";

export const FILES_VIEW_MODE_STORAGE_KEY = "files-view-mode";

export type FilesViewMode = "list" | "grid";

export function parseFilesViewMode(
  value: string | null | undefined
): FilesViewMode | null {
  return value === "list" || value === "grid" ? value : null;
}

export function getStoredFilesViewMode(): FilesViewMode {
  try {
    return (
      parseFilesViewMode(localStorage.getItem(FILES_VIEW_MODE_STORAGE_KEY)) ??
      "list"
    );
  } catch {
    return "list";
  }
}

export function setStoredFilesViewMode(mode: FilesViewMode): void {
  try {
    localStorage.setItem(FILES_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // private mode / quota — preference is best-effort
  }
}

export function resolveFilesProfileId(input: {
  activeProfileId?: string | null;
  profiles: ReadonlyArray<Pick<ProfileSummary, "id">>;
}): string | null {
  return (
    pickKnownProfileId(input.profiles, input.activeProfileId) ??
    resolveDefaultProfileId(input.profiles)
  );
}

export function legacyArtifactProfileId(
  search: string,
  profiles: ReadonlyArray<Pick<ProfileSummary, "id">>
): string | null {
  const requested = new URLSearchParams(search).get("profile");
  return pickKnownProfileId(profiles, requested);
}

/** Bytes the browser loads whole before it can show anything. */
const PREVIEW_BYTE_CAP = 10 * 1024 * 1024;

/**
 * Whether the All files panel can show this entry rather than only offer it.
 *
 * The cap guards the types served raw. A Word file is not one of them: the
 * server converts it and answers markdown, so a 12 MB .docx full of images
 * arrives as a few tens of kilobytes. Capping on the file would refuse a
 * request that is never made.
 */
export function canPreviewWorkspaceEntry(input: {
  isImage: boolean;
  isPdf: boolean;
  isText: boolean;
  isVideo: boolean;
  isWordDocument: boolean;
  sizeBytes: number;
}): boolean {
  const withinCap = input.isWordDocument || input.sizeBytes <= PREVIEW_BYTE_CAP;

  return (
    withinCap && (input.isImage || input.isVideo || input.isPdf || input.isText)
  );
}
