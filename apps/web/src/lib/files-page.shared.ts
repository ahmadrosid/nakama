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
