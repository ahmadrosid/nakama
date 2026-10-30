import type { StoredProfileRecord } from "@nakama/db";
import type { AgentService } from "./agent-service";
import type { TurnStart } from "./turn-runner";

/**
 * Starts a turn whose caller already left. It takes the lock and prepares the
 * chat, then ends without sending, so history stays as it was.
 */
export async function startStoppedTurn(
  agent: AgentService,
  sessionId: string,
  orgId: string
): Promise<TurnStart["status"]> {
  const turn = await agent.turns.start(
    sessionId,
    orgId,
    { message: "" },
    { signal: AbortSignal.abort() }
  );

  if (turn.status === "started") {
    await turn.done;
  }

  return turn.status;
}

export function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: "profile_default",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default",
    orgId: "org_test",
    systemPrompt: "You are helpful.",
    updatedAt: now,
  };
}
