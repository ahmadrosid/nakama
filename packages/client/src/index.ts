export { NakamaClient } from "./client";
export type {
  RemoteChatSession,
  SendMessageArg,
  SendStreamOptions,
  StreamHandler,
  StreamHandlers,
  NakamaClientOptions,
} from "./types";
export { formatClientError as formatError, NakamaApiError } from "@nakama/core/api-error";

import type { ProfileSummary } from "@nakama/core/contract";
import { NakamaClient } from "./client";
import type { NakamaClientOptions } from "./types";

export function createClient(options?: NakamaClientOptions): NakamaClient {
  return new NakamaClient(options);
}

export function getProfileAvatarUrl(
  profile: Pick<ProfileSummary, "id" | "hasAvatar" | "updatedAt">,
): string | null {
  if (!profile.hasAvatar) {
    return null;
  }

  const query = new URLSearchParams({ v: profile.updatedAt });
  return `/v1/profiles/${encodeURIComponent(profile.id)}/avatar?${query.toString()}`;
}
