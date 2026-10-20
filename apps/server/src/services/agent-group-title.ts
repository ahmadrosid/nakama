import { groupSessionTitle } from "@nakama/core/agent-groups";
import {
  getGroupSession,
  listAgentGroupMessages,
  type StoredGroupSession,
  updateGroupSession,
} from "./agent-group-store";
import type { AgentService } from "./agent-service";

/**
 * After the first agent reply, swaps the first-line title for a generated
 * one, like the main chat. A title the user changed stays.
 */
export function retitleGroupSession(
  agent: Pick<AgentService, "generateSessionTitle">,
  orgId: string,
  userId: string,
  session: StoredGroupSession,
  profileId: string,
  reply: string
): Promise<void> | null {
  const messages = listAgentGroupMessages(orgId, session.id);
  const first = messages[0];

  if (
    !first ||
    first.authorProfileId !== null ||
    messages.filter((message) => message.authorProfileId !== null).length !== 1
  ) {
    return null;
  }

  const placeholder = groupSessionTitle(
    first.content || (first.files?.[0] ?? "")
  );

  const isPlaceholder = () =>
    getGroupSession(orgId, userId, session.groupId, session.id)?.title ===
    placeholder;

  if (!isPlaceholder()) {
    return null;
  }

  const userText = [
    first.content,
    ...(first.files ?? []).map((name) => `[File: ${name}]`),
  ]
    .filter(Boolean)
    .join("\n");

  const generate = async () => {
    const title = await agent.generateSessionTitle(profileId, [
      { content: userText, role: "user" },
      { content: reply, role: "assistant" },
    ]);

    if (title && isPlaceholder()) {
      updateGroupSession(orgId, userId, session.groupId, session.id, {
        title,
      });
    }
  };

  return generate().catch((error) => {
    console.error(
      `Failed to generate group session title for ${session.id}:`,
      error
    );
  });
}
