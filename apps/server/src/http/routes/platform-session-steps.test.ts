import { describe, expect, test } from "bun:test";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
} from "../test-session-helpers";

const BASE = "http://localhost:4310";

const ORG_ID = "org_steps";

const PROFILE_ID = "profile_steps";

const PASSWORD = "password123";

async function seedSession(
  db: DatabaseAdapter,
  sessionId = "session_steps",
  orgId = ORG_ID
) {
  const now = "2026-01-01T00:00:00.000Z";

  await db.upsertOrganization({
    createdAt: now,
    id: orgId,
    name: orgId,
    slug: orgId,
    updatedAt: now,
  });
  await db.upsertProfile({
    createdAt: now,
    id: PROFILE_ID,
    isDefault: true,
    isSuper: false,
    model: null,
    name: PROFILE_ID,
    orgId,
    systemPrompt: "",
    updatedAt: now,
  });
  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: now,
    id: sessionId,
    model: null,
    orgId,
    profileId: PROFILE_ID,
    title: null,
  });
}

async function addStep(
  db: DatabaseAdapter,
  sessionId: string,
  toolName: string,
  startedAt: string
) {
  expect(
    await db.appendSessionStep({
      actor: "agent",
      completedAt: startedAt,
      orgId: ORG_ID,
      outcome: "success",
      profileId: PROFILE_ID,
      sessionId,
      startedAt,
      toolName,
    })
  ).toBe(true);
}

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({ databaseAdapter });
  await seedOrgAdmin(databaseAdapter, {
    email: "orgadmin@example.com",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
    userId: "user_org_steps",
  });
  await seedOrgAdmin(databaseAdapter, {
    email: "orgmember@example.com",
    orgId: ORG_ID,
    role: "member",
    userId: "user_org_member",
  });
  await seedSession(databaseAdapter);
  await addStep(
    databaseAdapter,
    "session_steps",
    "read_file",
    "2026-01-01T10:00:00.000Z"
  );
  await addStep(
    databaseAdapter,
    "session_steps",
    "write_file",
    "2026-01-01T11:00:00.000Z"
  );
  await addStep(
    databaseAdapter,
    "session_steps",
    "search_files",
    "2026-01-01T12:00:00.000Z"
  );

  const platform = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const orgAdmin = await loginUserSession(
    app,
    "orgadmin@example.com",
    PASSWORD,
    ORG_ID
  );

  const orgMember = await loginUserSession(
    app,
    "orgmember@example.com",
    PASSWORD,
    ORG_ID
  );

  function get(
    path: string,
    headers: Record<string, string> = {},
    authenticated = true
  ) {
    return app.fetch(
      new Request(`${BASE}${path}`, {
        headers: authenticated ? headers : {},
      })
    );
  }

  const stepsPath = `/v1/platform/orgs/${ORG_ID}/sessions/session_steps/steps`;

  return {
    app,
    databaseAdapter,
    get,
    orgAdmin,
    orgMember,
    platform,
    stepsPath,
  };
}

describe("platform session step window", () => {
  test("lets only a platform admin read an explicit org and keeps the payload minimal", async () => {
    const { databaseAdapter, get, orgAdmin, orgMember, platform, stepsPath } =
      await createScenario();

    expect((await get(stepsPath, {}, false)).status).toBe(401);
    expect((await get(stepsPath, orgAdmin.headers())).status).toBe(403);
    expect((await get(stepsPath, orgMember.headers())).status).toBe(403);

    // The active org header is unrelated to the path org.
    const response = await get(
      stepsPath,
      platform.headers({}, "org_somewhere_else")
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(["next", "previous", "step"]);
    expect(Object.keys(body.step).sort()).toEqual([
      "actor",
      "completedAt",
      "id",
      "outcome",
      "startedAt",
      "toolName",
    ]);
    expect(body.step.toolName).toBe("read_file");
    expect(body.previous).toBeNull();
    expect(body.next.startedAt).toBe("2026-01-01T11:00:00.000Z");
    expect(JSON.stringify(body)).not.toContain(PROFILE_ID);
    expect(JSON.stringify(body)).not.toContain("session_steps");

    // Wrong org and a missing session look the same.
    expect(
      (
        await get(
          "/v1/platform/orgs/other_org/sessions/session_steps/steps",
          platform.headers()
        )
      ).status
    ).toBe(404);
    expect(
      (
        await get(
          `/v1/platform/orgs/${ORG_ID}/sessions/missing/steps`,
          platform.headers()
        )
      ).status
    ).toBe(404);

    await seedSession(databaseAdapter, "session_empty");

    const empty = await get(
      `/v1/platform/orgs/${ORG_ID}/sessions/session_empty/steps`,
      platform.headers()
    );

    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({
      next: null,
      previous: null,
      step: null,
    });
  });

  test("validates the timestamp and cursors, and normalizes an offset to UTC", async () => {
    const { get, platform, stepsPath } = await createScenario();

    expect(
      (await get(`${stepsPath}?at=yesterday`, platform.headers())).status
    ).toBe(400);
    expect((await get(`${stepsPath}?id=abc`, platform.headers())).status).toBe(
      400
    );
    expect((await get(`${stepsPath}?id=9999`, platform.headers())).status).toBe(
      400
    );

    const offset = await get(
      `${stepsPath}?at=2026-01-01T13:00:00%2B02:00`,
      platform.headers()
    );

    expect(offset.status).toBe(200);
    const body = await offset.json();
    expect(body.step.toolName).toBe("write_file");
    expect(body.next.startedAt).toBe("2026-01-01T12:00:00.000Z");

    const before = await get(
      `${stepsPath}?at=2026-01-01T09:00:00.000Z`,
      platform.headers()
    );

    expect(await before.json()).toEqual({
      next: { id: expect.any(Number), startedAt: "2026-01-01T10:00:00.000Z" },
      previous: null,
      step: null,
    });
  });

  test("prefers a valid id over at", async () => {
    const { get, platform, stepsPath } = await createScenario();

    const response = await get(
      `${stepsPath}?at=2026-01-01T10:00:00.000Z&id=3`,
      platform.headers()
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.step.id).toBe(3);
    expect(body.step.toolName).toBe("search_files");
  });

  test("uses the current session org after a move", async () => {
    const { databaseAdapter, get, platform, stepsPath } =
      await createScenario();

    await seedSession(databaseAdapter, "session_placeholder", "org_moved");
    await databaseAdapter.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "session_steps",
      model: null,
      orgId: "org_moved",
      profileId: PROFILE_ID,
      title: null,
    });

    expect((await get(stepsPath, platform.headers())).status).toBe(404);

    const moved = await get(
      "/v1/platform/orgs/org_moved/sessions/session_steps/steps",
      platform.headers()
    );

    expect(moved.status).toBe(200);
    expect((await moved.json()).step.toolName).toBe("read_file");
  });

  test("documents the route and its query in OpenAPI", async () => {
    const { app } = await createScenario();

    const spec = await (
      await app.fetch(new Request(`${BASE}/openapi.json`))
    ).json();

    const route =
      spec.paths["/v1/platform/orgs/{orgId}/sessions/{sessionId}/steps"];

    expect(route.get.operationId).toBe("getPlatformSessionStepWindow");
    expect(route.get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "query", name: "at" }),
        expect.objectContaining({ in: "query", name: "id" }),
      ])
    );
  });
});
