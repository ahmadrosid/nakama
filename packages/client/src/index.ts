export {
  formatClientError as formatError,
  NakamaApiError,
  NakamaAuthExpiredError,
} from "@nakama/core/api-error";
export { NakamaClient } from "./client";
export type {
  NakamaClientOptions,
  RemoteChatSession,
  SendMessageArg,
  SendStreamOptions,
  StreamHandler,
  StreamHandlers,
} from "./types";

import type { ProfileSummary } from "@nakama/core/contract";

export function getProfileAvatarUrl(
  profile: Pick<ProfileSummary, "id" | "hasAvatar" | "updatedAt">
): string | null {
  if (!profile.hasAvatar) {
    return null;
  }

  const query = new URLSearchParams({ v: profile.updatedAt });
  return `/v1/profiles/${encodeURIComponent(profile.id)}/avatar?${query.toString()}`;
}
