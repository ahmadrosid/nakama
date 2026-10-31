import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-sessions-stop-test-");

const ORG = "org_stop";

describe("POST /v1/sessions/:id/stop", () => {
  test("ends the turn running in the caller's chat", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const agent = new AgentService(null, null, databaseAdapter);
    const { app } = createMinimalHonoApp({ agent, databaseAdapter });

    const { email, password } = await seedOrgAdmin(databaseAdapter, {
      orgId: ORG,
      profileId: "profile_stop",
      userId: "user_stop",
    });

    const session = await loginUserSession(app, email, password, ORG);

    const sessionId = await agent.createSession(
      ORG,
      "web",
      "profile_stop",
      "user_stop"
    );

    const turn = new AbortController();
    sessionTurnRegistry.beginTurn(sessionId);
    sessionTurnRegistry.attachAbort(sessionId, turn);

    const response = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${sessionId}/stop`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    expect(response.status).toBe(204);
    expect(turn.signal.aborted).toBe(true);
    sessionTurnRegistry.cancelTurn(sessionId);
  });
});
