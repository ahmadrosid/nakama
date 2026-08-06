const STORAGE_PREFIX = "nakama:artifact-share:";

export function artifactShareStorageKey(
  orgId: string,
  profileId: string,
  artifactPath: string,
): string {
  return `${STORAGE_PREFIX}${orgId}:${profileId}:${artifactPath}`;
}

export function readStoredArtifactShare(input: {
  orgId: string;
  profileId: string;
  artifactPath: string;
}): { shareId: string; shareUrl: string } | null {
  try {
    const raw = localStorage.getItem(
      artifactShareStorageKey(input.orgId, input.profileId, input.artifactPath),
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { shareId?: string; shareUrl?: string };
    if (!parsed.shareId || !parsed.shareUrl) {
      return null;
    }

    return { shareId: parsed.shareId, shareUrl: parsed.shareUrl };
  } catch {
    return null;
  }
}

export function writeStoredArtifactShare(input: {
  orgId: string;
  profileId: string;
  artifactPath: string;
  shareId: string;
  shareUrl: string;
}): void {
  localStorage.setItem(
    artifactShareStorageKey(input.orgId, input.profileId, input.artifactPath),
    JSON.stringify({ shareId: input.shareId, shareUrl: input.shareUrl }),
  );
}

export function clearStoredArtifactShare(input: {
  orgId: string;
  profileId: string;
  artifactPath: string;
}): void {
  localStorage.removeItem(
    artifactShareStorageKey(input.orgId, input.profileId, input.artifactPath),
  );
}
