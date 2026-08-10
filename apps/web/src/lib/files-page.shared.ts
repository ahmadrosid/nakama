import type { ProfileSummary } from "@nakama/core/contract";
import {
  pickKnownProfileId,
  resolveDefaultProfileId,
} from "@/lib/chat-history";

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
