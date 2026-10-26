import type { ProfileSummary } from "@nakama/core";
import type { GroupTurnRunInput } from "../tools/sub-agent-shared";
import { AgentGroupService } from "./agent-group-service";

export const ORG_ID = "org_test";

export const USER_ID = "u1";

/** A service with three profiles and an agent that answers with `reply`. */
export function setup(
  reply: (input: GroupTurnRunInput) => string | Promise<string>
) {
  // SAFETY: The service reads only these ProfileSummary fields.
  const profiles = [
    { id: "a", isSuper: false, name: "Alpha", sharedWithTeam: true },
    { id: "b", isSuper: false, name: "Beta", sharedWithTeam: true },
    {
      id: "s",
      isSuper: false,
      name: "Secret",
      ownerUserId: "u2",
      sharedWithTeam: false,
    },
  ] as ProfileSummary[];

  const state = { inOrg: true, title: "" };
  const calls: string[] = [];

  // SAFETY: Tests implement only the two lookups the service reads.
  const db = {
    getOrgMember: async () => (state.inOrg ? { role: "member" } : null),
    getUserById: async () => ({ id: USER_ID }),
  } as never;

  // SAFETY: Tests implement only the agent calls the service makes.
  const agent = {
    generateSessionTitle: async () => state.title || null,
    listProfiles: async () => ({ profiles }),
    runGroupTurn: async (input: GroupTurnRunInput) => {
      calls.push(input.profileId);
      const output = await reply(input);

      return { output, status: "success", summary: output };
    },
  } as never;

  const service = new AgentGroupService(db, agent);

  /** Opens a session with `content` and waits for the replies. */
  async function chat(groupId: string, content: string) {
    const { run, session } = service.start(ORG_ID, USER_ID, groupId, content);
    await run;

    return session.id;
  }

  function contents(groupId: string, sessionId: string) {
    return service
      .session(ORG_ID, USER_ID, groupId, sessionId)
      .messages.map((message) => message.content);
  }

  return { calls, chat, contents, profiles, service, state };
}
