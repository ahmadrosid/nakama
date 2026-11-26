import { afterEach, describe, expect, test } from "bun:test";
import { loadLocalAuthToken } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  closeAgentGroupDatabases,
  createAgentGroup,
} from "../../services/agent-group-store";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedLocalClientUser } from "../test-org-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

afterEach(closeAgentGroupDatabases);

setupTestConfigDir("nakama-telegram-agent-group-");

const BASE = "http://localhost:4310";

const ORG_ID = "org_tg_group";

const USER_ID = "user_tg_group";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const agent = new AgentService(
    { defaultProviderId: null, providers: [] },
    null,
    databaseAdapter
  );

  agent.runGroupTurn = async () => ({
    output: "on it",
    status: "success",
    summary: "on it",
  });
  agent.generateSessionTitle = async () => null;

  const { app } = createMinimalHonoApp({ agent, databaseAdapter });

  await seedOrgAdmin(databaseAdapter, {
    email: "tg-group@example.com",
    orgId: ORG_ID,
    profileId: "alpha",
    userId: USER_ID,
  });
  await databaseAdapter.upsertProfile({
    createdAt: new Date().toISOString(),
    id: "beta",
    isSuper: false,
    model: "openrouter/auto",
    name: "Beta",
    orgId: ORG_ID,
    systemPrompt: "You are helpful.",
    updatedAt: new Date().toISOString(),
  });
  await seedLocalClientUser(databaseAdapter);

  const session = await loginUserSession(
    app,
    "tg-group@example.com",
    "password123",
    ORG_ID
  );

  const setTarget = (groupId: string | null) =>
    app.fetch(
      new Request(`${BASE}/v1/settings/telegram/agent-group?profileId=alpha`, {
        body: JSON.stringify({ groupId }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );

  const token = await loadLocalAuthToken();

  const postFromBot = async (content: string, sessionId: string | null) =>
    app.fetch(
      new Request(`${BASE}/v1/internal/telegram/agent-group-messages`, {
        body: JSON.stringify({
          content,
          orgId: ORG_ID,
          profileId: "alpha",
          sessionId,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

  return { postFromBot, setTarget };
}

describe("Telegram bot in front of an Agent Group", () => {
  test("every agent woken in the group answers, by handle, in one session", async () => {
    const { postFromBot, setTarget } = await createScenario();

    const group = createAgentGroup(
      ORG_ID,
      USER_ID,
      "Launch",
      ["alpha", "beta"],
      "",
      {
        alpha: "alpha",
        beta: "beta",
      }
    );

    expect((await setTarget(group.id)).status).toBe(200);

    const first = await postFromBot("@all plan the launch", null);
    expect(first.status).toBe(200);

    // SAFETY: the 200 above is the route's success shape.
    const body = (await first.json()) as {
      replies: { author: string; content: string }[];
      sessionId: string;
    };

    expect(body.replies).toEqual([
      { author: "@alpha", content: "on it" },
      { author: "@beta", content: "on it" },
    ]);

    // The next message continues that chat and returns only the new replies.
    const next = await postFromBot("@beta and the budget?", body.sessionId);
    expect(await next.json()).toEqual({
      replies: [{ author: "@beta", content: "on it" }],
      sessionId: body.sessionId,
    });
  });

  test("a bot without a group target is refused, and so is someone else's group", async () => {
    const { postFromBot, setTarget } = await createScenario();

    const theirs = createAgentGroup(ORG_ID, "someone_else", "Theirs", [
      "alpha",
      "beta",
    ]);

    expect((await postFromBot("hello", null)).status).toBe(409);
    expect((await setTarget(theirs.id)).status).toBe(404);
    expect((await postFromBot("hello", null)).status).toBe(409);
  });
});
