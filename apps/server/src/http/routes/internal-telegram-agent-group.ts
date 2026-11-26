import { loadTelegramAgentGroup } from "@nakama/core/telegram-config";
import { z } from "zod";
import { listAgentGroupMessages } from "../../services/agent-group-store";
import type { ServerOptions } from "../context";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

const bodySchema = z.object({
  content: z.string().trim().min(1),
  orgId: z.string().min(1),
  profileId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
});

/**
 * A Telegram bot that answers for an Agent Group (#2509) posts here. The group
 * and the user it runs as come from the connection's saved target, never from
 * the request, so the worker cannot pick someone else's group.
 */
export function registerInternalTelegramAgentGroupRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;

  app.post("/v1/internal/telegram/agent-group-messages", async (c) => {
    const auth = c.get("auth");

    if (!auth || auth.mode !== "local-token") {
      return errorResponse("Authentication required", 401);
    }

    const { content, orgId, profileId, sessionId } = await readJson(
      c.req.raw,
      bodySchema
    );

    const target = await loadTelegramAgentGroup({ orgId, profileId });

    if (!target) {
      return errorResponse("This bot does not answer for an Agent Group.", 409);
    }

    const { groupId, ownerUserId } = target;

    const known = sessionId
      ? agent.groups
          .sessions(orgId, ownerUserId, groupId)
          .find((session) => session.id === sessionId)
      : undefined;

    // Replies are the agent messages written after this point.
    const after = known
      ? (listAgentGroupMessages(orgId, known.id).at(-1)?.id ?? 0)
      : 0;

    let groupSessionId: string;

    if (known) {
      groupSessionId = known.id;
      await agent.groups.post(orgId, ownerUserId, groupId, known.id, content);
    } else {
      const started = agent.groups.start(orgId, ownerUserId, groupId, content);
      groupSessionId = started.session.id;
      await started.run;
    }

    // The handle, since that is also how the chat addresses a member.
    const { handles } = agent.groups.get(orgId, ownerUserId, groupId);

    const replies = listAgentGroupMessages(orgId, groupSessionId)
      .filter(
        (message) =>
          message.id > after && message.authorProfileId && message.content
      )
      .map((message) => ({
        author: `@${handles[message.authorProfileId!] ?? "agent"}`,
        content: message.content,
      }));

    return json({ replies, sessionId: groupSessionId });
  });
}
