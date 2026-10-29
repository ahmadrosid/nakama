import { afterEach, describe, expect, test } from "bun:test";
import type { AgentGroupInput } from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { closeAgentGroupDatabases } from "../../services/agent-group-store";
import { AgentService } from "../../services/agent-service";
import { SuperNakamaSessionState } from "../../services/super-nakama-session-state";
import { setupTestConfigDir } from "../../test-config-dir";
import { createSuperNakamaTools } from "../../tools/super-nakama-tools";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

// Before the config dir cleanup, which Windows refuses while a file is open.
afterEach(closeAgentGroupDatabases);

setupTestConfigDir("nakama-agent-group-routes-");

const BASE = "http://localhost:4310";

type RequestBody =
  | AgentGroupInput
  | { content?: string; documents?: DocumentAttachment[] };

const ORG_ID = "org_groups";

const USER_ID = "user_groups";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const agent = new AgentService(
    { defaultProviderId: null, providers: [] },
    null,
    databaseAdapter
  );

  // Replies stay offline; the routes only start them.
  agent.runGroupTurn = async () => ({
    output: "ok",
    status: "success",
    summary: "ok",
  });
  agent.generateSessionTitle = async () => null;

  const { app } = createMinimalHonoApp({ agent, databaseAdapter });

  await seedOrgAdmin(databaseAdapter, {
    email: "groups@example.com",
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

  const session = await loginUserSession(
    app,
    "groups@example.com",
    "password123",
    ORG_ID
  );

  function send(method: string, path: string, body?: RequestBody) {
    return app.fetch(
      new Request(`${BASE}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method,
      })
    );
  }

  return { agent, app, send };
}

const GOOD_GROUP = { memberIds: ["alpha", "beta"], name: "Launch" };

const BAD_GROUPS = [
  { memberIds: ["alpha"], name: "Solo" },
  { memberIds: Array.from({ length: 13 }, (_, i) => `p${i}`), name: "Crowd" },
  { memberIds: ["alpha", "beta"], name: "   " },
  { memberIds: ["alpha", "beta"], name: "x".repeat(81) },
  { brief: "x".repeat(4001), memberIds: ["alpha", "beta"], name: "Long" },
  { memberIds: ["alpha", ""], name: "Blank member" },
  { extra: true, memberIds: ["alpha", "beta"], name: "Extra key" },
];

const DOCUMENT_ONLY = {
  documents: [
    {
      data: Buffer.from("notes").toString("base64"),
      filename: "notes.txt",
      mediaType: "text/plain",
    },
  ],
};

describe("agent group routes", () => {
  test("/openapi.json documents every group route Hono serves", async () => {
    const { app } = createMinimalHonoApp();

    const spec: ReturnType<typeof app.getOpenAPI31Document> = await (
      await app.fetch(new Request(`${BASE}/openapi.json`))
    ).json();

    const served = app.routes.filter(
      (r) =>
        r.method !== "ALL" &&
        (r.path.startsWith("/v1/agent-groups") ||
          r.path.startsWith("/v1/rail-pins"))
    );

    expect(served.length).toBeGreaterThan(20);

    for (const r of served) {
      const path = r.path.replaceAll(/:(\w+)/g, "{$1}");
      // SAFETY: `served` holds only the HTTP methods the routes register.
      const method = r.method.toLowerCase() as "get";

      expect({
        method,
        path,
        documented: !!spec.paths?.[path]?.[method],
      }).toEqual({
        documented: true,
        method,
        path,
      });
    }

    const session = "/v1/agent-groups/{groupId}/sessions/{sessionId}";
    const bodyOf = (path: string) => spec.paths?.[path]?.post?.requestBody;

    expect(bodyOf(`${session}/threads/{messageId}/messages`)).toEqual(
      bodyOf(`${session}/messages`)
    );
    expect(bodyOf("/v1/agent-groups/{groupId}/sessions")).toEqual(
      bodyOf(`${session}/messages`)
    );

    expect(spec.paths?.[session]?.get?.parameters).toMatchObject([
      { in: "path", name: "groupId" },
      { in: "path", name: "sessionId" },
    ]);
    expect(
      spec.paths?.["/v1/agent-groups/{groupId}/files/content"]?.get?.parameters
    ).toContainEqual(
      expect.objectContaining({ in: "query", name: "path", required: true })
    );
    expect(
      Object.keys(
        spec.paths?.["/v1/agent-groups/{groupId}/sessions"]?.post?.responses ??
          {}
      )
    ).toEqual(["201"]);
  });

  test("message routes accept a message that holds only a document", async () => {
    const { send } = await createScenario();

    const group = await (
      await send("POST", "/v1/agent-groups", GOOD_GROUP)
    ).json();

    const started = await send(
      "POST",
      `/v1/agent-groups/${group.id}/sessions`,
      DOCUMENT_ONLY
    );

    expect(started.status).toBe(201);

    const sessionPath = `/v1/agent-groups/${group.id}/sessions/${(await started.json()).id}`;

    // Waits for the background replies, so none outlives the test.
    async function settled() {
      for (let tries = 0; tries < 100; tries += 1) {
        const detail = await (await send("GET", sessionPath)).json();

        if (!(detail.session.active || detail.threadRunIds.length > 0)) {
          return detail;
        }

        await Bun.sleep(20);
      }

      throw new Error("Replies did not finish");
    }

    const reply = (await settled()).messages.find(
      (message: { authorProfileId: string | null }) => message.authorProfileId
    );

    expect(
      (await send("POST", `${sessionPath}/messages`, DOCUMENT_ONLY)).status
    ).toBe(204);
    await settled();
    expect(
      (
        await send(
          "POST",
          `${sessionPath}/threads/${reply.id}/messages`,
          DOCUMENT_ONLY
        )
      ).status
    ).toBe(204);
    await settled();
    expect(
      (await send("POST", `${sessionPath}/messages`, { content: " " })).status
    ).toBe(400);
  });

  test("create_group and POST /v1/agent-groups reject the same inputs", async () => {
    const { agent, send } = await createScenario();

    let created = 0;

    const tool = createSuperNakamaTools(
      // SAFETY: create_group never touches the profile service.
      {} as never,
      new SuperNakamaSessionState(),
      undefined,
      undefined,
      {
        createGroup: (orgId, userId, name, memberIds, brief) => {
          created += 1;

          return agent.groups.create(orgId, userId, name, memberIds, brief);
        },
      }
    ).find((candidate) => candidate.name === "create_group");

    const context = { orgId: ORG_ID, userId: USER_ID };

    for (const input of BAD_GROUPS) {
      expect((await send("POST", "/v1/agent-groups", input)).status).toBe(400);
      await expect(tool?.run(input, context)).rejects.toThrow();
    }

    // The schema stopped every bad input; none reached the service.
    expect(created).toBe(0);

    expect((await send("POST", "/v1/agent-groups", GOOD_GROUP)).status).toBe(
      201
    );
    expect(await tool?.run(GOOD_GROUP, context)).toMatchObject({
      type: "group_created",
    });

    const listed = await (await send("GET", "/v1/agent-groups")).json();

    expect(listed.groups).toHaveLength(2);
  });

  test("an unknown group is not found", async () => {
    const { send } = await createScenario();

    expect((await send("GET", "/v1/agent-groups/missing")).status).toBe(404);
    expect(
      (await send("GET", "/v1/agent-groups/missing/sessions")).status
    ).toBe(404);
    expect(
      (await send("PUT", "/v1/agent-groups/missing/memory", { content: " " }))
        .status
    ).toBe(404);
    expect(
      (await send("GET", "/v1/agent-groups/missing/files/content")).status
    ).toBe(404);
  });

  test("a file download without a path is a bad request", async () => {
    const { send } = await createScenario();

    const group = await (
      await send("POST", "/v1/agent-groups", GOOD_GROUP)
    ).json();

    expect(
      (await send("GET", `/v1/agent-groups/${group.id}/files/content`)).status
    ).toBe(400);
  });
});
