import type { ProfileSummary } from "@nakama/core";
import type { AgentGroup } from "@nakama/core/agent-groups";
import { listAgentGroupMessages } from "./agent-group-store";

const CONTEXT_MESSAGES = 40;

const CONTEXT_CHARS = 24_000;

/** The group's members the user can still reach, in member order. */
export function groupMembers(
  group: AgentGroup,
  profiles: ProfileSummary[]
): ProfileSummary[] {
  return group.memberIds.flatMap(
    (id) => profiles.find((profile) => profile.id === id) ?? []
  );
}

function handleOf(handles: Map<string, string>, profileId: string): string {
  return [...handles].find(([, id]) => id === profileId)?.[0] ?? "";
}

export function groupTask(
  group: AgentGroup,
  speaker: ProfileSummary,
  handles: Map<string, string>
): string {
  const roster = [...handles]
    .map(([handle, id]) => `@${handle}${id === speaker.id ? " (you)" : ""}`)
    .join(", ");

  return [
    `You are ${speaker.name} (@${handleOf(handles, speaker.id)}) in the group chat "${group.name}" with the user and these agents: ${roster}.`,
    "The conversation so far is under Context, newest last. Reply to it as yourself.",
    "This is a chat message, not a report: keep it conversational and do not prefix it with your name.",
    "To hand the conversation to another agent, mention their @handle. Mention nobody when you are done or the user should answer.",
    "When the user writes @all, every agent answers in turn; you never use @all yourself.",
  ].join("\n");
}

/** The session's recent messages as a labelled transcript for the speaker. */
export function transcript(
  orgId: string,
  sessionId: string,
  handles: Map<string, string>,
  members: ProfileSummary[]
): string {
  const lines = listAgentGroupMessages(orgId, sessionId, CONTEXT_MESSAGES).map(
    ({ authorProfileId, content }) => {
      if (authorProfileId === null) {
        return `User: ${content}`;
      }

      const author = members.find((p) => p.id === authorProfileId);

      return author
        ? `${author.name} (@${handleOf(handles, author.id)}): ${content}`
        : `Unavailable agent: ${content}`;
    }
  );

  return lines.join("\n\n").slice(-CONTEXT_CHARS);
}
