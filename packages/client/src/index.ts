export { NakamaApiError, NakamaAuthExpiredError } from "@nakama/core/api-error";
export { NakamaClient } from "./client";
export type {
  RemoteChatSession,
  SendMessageArg,
  StreamHandlers,
} from "./types";

import type { ProfileSummary } from "@nakama/core/contract";

export function getProfileAvatarUrl(
  profile: Pick<ProfileSummary, "id" | "hasAvatar" | "updatedAt">,
  orgId?: string
): string | null {
  if (!profile.hasAvatar) {
    return null;
  }

  const query = new URLSearchParams({ v: profile.updatedAt });
  if (orgId) {
    query.set("orgId", orgId);
  }
  return `/v1/profiles/${encodeURIComponent(profile.id)}/avatar?${query.toString()}`;
}
