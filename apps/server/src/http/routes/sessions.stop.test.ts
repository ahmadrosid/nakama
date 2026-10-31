import { describe, expect, spyOn, test } from "bun:test";
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

  test("a browser stream that drops leaves the turn running", async () => {
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

    let signal: AbortSignal | undefined;
    let started = false;

    spyOn(agent.turns, "start").mockImplementation(
      async (_id, _org, _input, options = {}) => {
        started = true;
        signal = options.signal;

        return { status: "busy" };
      }
    );

    const request = new AbortController();

    await app.fetch(
      new Request(
        `http://localhost:4310/v1/sessions/${sessionId}/messages?stream=true`,
        {
          body: JSON.stringify({ message: "hi" }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
          signal: request.signal,
        }
      )
    );

    request.abort();

    // Only /stop ends a web turn; a locked phone must not.
    expect(started).toBe(true);
    expect(signal?.aborted ?? false).toBe(false);
  });
});
