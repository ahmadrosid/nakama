import { NakamaApiError } from "@nakama/core";
import type { Context } from "hono";
import type { AgentService } from "../services/agent-service";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
  requireProfileManageFromContext,
} from "./org-guards";
import type { AppEnv } from "./types";

export interface ChannelOwnerScope {
  orgId: string;
  profileId: string;
}

/**
 * The owner of a channel connection: the caller's active organization and the
 * agent they selected. Every channel resolves it here so one check decides who
 * may manage a connection.
 */
export async function resolveChannelOwner(
  c: Context<AppEnv>,
  agent: AgentService
): Promise<ChannelOwnerScope> {
  const orgId = requireActiveOrgIdFromContext(c);
  const profileId = c.req.query("profileId")?.trim();

  if (!profileId) {
    // Without an agent there is nothing a member could own.
    requireOrgAdminOrPlatformAdminFromContext(c);

    throw new NakamaApiError("Choose an agent to manage this connection.", 400);
  }

  // Admins manage any agent's connections. Members manage their own agent's.
  await requireProfileManageFromContext(c, agent, {
    allowOrgAdmin: true,
    profileId,
  });

  const { profile } = await agent.getProfile(orgId, profileId);

  // A channel worker talks to the server as the local client, and the server
  // refuses that client for Super Nakama, so such a bridge can never answer.
  if (profile.isSuper) {
    throw new NakamaApiError(
      "Super Nakama cannot be connected to a channel. Choose another agent.",
      400
    );
  }

  return { orgId, profileId };
}
