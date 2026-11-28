import { afterEach, describe, expect, test } from "bun:test";
import { loadLocalAuthToken, saveTelegramAgentGroup } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  closeAgentGroupDatabases,
  createAgentGroup,
  listAgentGroupMessages,
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

  const botPost = (
    path: string,
    body: Record<string, string | null>,
    signal?: AbortSignal
  ) =>
    app.fetch(
      new Request(`${BASE}/v1/internal/telegram/${path}`, {
        body: JSON.stringify({ orgId: ORG_ID, profileId: "alpha", ...body }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      })
    );

  const openSession = (sessionId: string | null) =>
    botPost("agent-group-sessions", { sessionId, title: "hello" });

  const postFromBot = (
    content: string,
    sessionId: string,
    signal?: AbortSignal
  ) => botPost("agent-group-messages", { content, sessionId }, signal);

  return { agent, openSession, postFromBot, setTarget };
}

function launchGroup() {
  return createAgentGroup(ORG_ID, USER_ID, "Launch", ["alpha", "beta"], "", {
    alpha: "alpha",
    beta: "beta",
  });
}

async function sessionIdOf(response: Response): Promise<string> {
  expect(response.status).toBe(200);

  // SAFETY: the 200 above is the route's success shape.
  return ((await response.json()) as { sessionId: string }).sessionId;
}

describe("Telegram bot in front of an Agent Group", () => {
  test("every agent woken in the group answers, by handle, in one session", async () => {
    const { openSession, postFromBot, setTarget } = await createScenario();

    expect((await setTarget(launchGroup().id)).status).toBe(200);

    const sessionId = await sessionIdOf(await openSession(null));

    // The worker gets the same session back while it exists.
    expect(await sessionIdOf(await openSession(sessionId))).toBe(sessionId);
    expect(await sessionIdOf(await openSession("gone"))).not.toBe(sessionId);

    const first = await postFromBot("@all plan the launch", sessionId);

    expect(await first.json()).toEqual({
      failed: false,
      replies: [
        { author: "@alpha", content: "on it" },
        { author: "@beta", content: "on it" },
      ],
    });

    // The next message continues that chat and returns only the new replies.
    const next = await postFromBot("@beta and the budget?", sessionId);

    expect(await next.json()).toEqual({
      failed: false,
      replies: [{ author: "@beta", content: "on it" }],
    });
    expect(listAgentGroupMessages(ORG_ID, sessionId)).toHaveLength(5);
  });

  test("a turn error is reported as failed, and its text stays on the server", async () => {
    const { agent, openSession, postFromBot, setTarget } =
      await createScenario();

    agent.runGroupTurn = async ({ profileId }) => {
      if (profileId === "alpha") {
        throw new Error("provider key sk-secret rejected");
      }

      return { output: "on it", status: "success", summary: "on it" };
    };

    await setTarget(launchGroup().id);

    const sessionId = await sessionIdOf(await openSession(null));
    const response = await postFromBot("@all plan the launch", sessionId);

    expect(await response.json()).toEqual({
      failed: true,
      replies: [{ author: "@beta", content: "on it" }],
    });
  });

  test("a message into an active run waits for it and gets its replies", async () => {
    const { agent, openSession, postFromBot, setTarget } =
      await createScenario();

    const release = Promise.withResolvers<void>();

    agent.runGroupTurn = async () => {
      await release.promise;

      return { output: "on it", status: "success", summary: "on it" };
    };

    const group = launchGroup();
    await setTarget(group.id);

    const sessionId = await sessionIdOf(await openSession(null));

    // The owner writes in the same session from the web first.
    const web = agent.groups.post(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId,
      "@alpha hi"
    );

    const fromBot = postFromBot("@beta and you?", sessionId);

    await Bun.sleep(20);
    release.resolve();
    await web;

    // SAFETY: the route's success shape.
    const body = (await (await fromBot).json()) as {
      replies: { author: string }[];
    };

    expect(body.replies.map((reply) => reply.author)).toEqual([
      "@alpha",
      "@beta",
    ]);
  });

  test("a request that ends stops the run", async () => {
    const { agent, openSession, postFromBot, setTarget } =
      await createScenario();

    let turns = 0;

    agent.runGroupTurn = ({ signal }) => {
      turns += 1;

      return new Promise((resolve) => {
        signal?.addEventListener("abort", () =>
          resolve({ output: "", status: "success", summary: "" })
        );
      });
    };

    await setTarget(launchGroup().id);

    const sessionId = await sessionIdOf(await openSession(null));
    const stop = new AbortController();
    const pending = postFromBot("@all plan the launch", sessionId, stop.signal);

    await Bun.sleep(20);
    stop.abort();

    // SAFETY: the route's success shape.
    const body = (await (await pending).json()) as { replies: unknown[] };

    expect(body.replies).toEqual([]);
    // @beta was queued, and the stop dropped it.
    expect(turns).toBe(1);
  });

  test("a deleted group, or an owner who left, puts the bot back on its agent", async () => {
    const { agent, openSession, postFromBot, setTarget } =
      await createScenario();

    const group = launchGroup();
    await setTarget(group.id);

    const sessionId = await sessionIdOf(await openSession(null));

    agent.groups.delete(ORG_ID, USER_ID, group.id);

    expect((await postFromBot("hello", sessionId)).status).toBe(409);
    expect(
      await agent.getTelegramAgentGroup({ orgId: ORG_ID, profileId: "alpha" })
    ).toEqual({ groupId: null });

    // A target saved by someone who is no longer in the org.
    const theirs = createAgentGroup(ORG_ID, "left_org", "Theirs", ["alpha"]);

    await saveTelegramAgentGroup(
      { orgId: ORG_ID, profileId: "alpha" },
      { groupId: theirs.id, ownerUserId: "left_org" }
    );

    expect((await openSession(null)).status).toBe(409);
  });

  test("a message over the size cap is refused", async () => {
    const { openSession, postFromBot, setTarget } = await createScenario();

    await setTarget(launchGroup().id);

    const sessionId = await sessionIdOf(await openSession(null));

    expect((await postFromBot("a".repeat(8001), sessionId)).status).toBe(400);
  });

  test("a bot without a group target is refused, and so is someone else's group", async () => {
    const { openSession, setTarget } = await createScenario();

    const theirs = createAgentGroup(ORG_ID, "someone_else", "Theirs", [
      "alpha",
      "beta",
    ]);

    expect((await openSession(null)).status).toBe(409);
    expect((await setTarget(theirs.id)).status).toBe(404);
    expect((await openSession(null)).status).toBe(409);
  });
});
