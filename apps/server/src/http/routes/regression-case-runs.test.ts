import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);
  const sent: Array<{ input: string; orgId: string; profileId: string }> = [];

  agent.runRegressionCase = async ({ input, orgId, profileId }) => {
    sent.push({ input, orgId, profileId });

    return { error: null, output: "Health check failed on the new pods." };
  };

  return {
    ...createMinimalHonoApp({
      agent,
      authService: new AuthService(),
      databaseAdapter,
    }),
    agent,
    sent,
  };
}

async function seedCase(
  databaseAdapter: DatabaseAdapter,
  orgId: string,
  profileId: string
): Promise<string> {
  await databaseAdapter.createRegressionCase({
    createdAt: "2026-11-11T09:00:00.000Z",
    createdByUserId: null,
    expectedResult: "Health check failed.",
    id: `regcase_${orgId}`,
    input: "Why did the deploy fail?",
    orgId,
    privateToUserId: null,
    profileId,
    sourceAutomationId: null,
    sourceId: "session_1",
    sourceType: "session",
  });

  return `regcase_${orgId}`;
}

async function signIn(
  app: ReturnType<typeof createApp>["app"],
  user: { email: string; orgId: string; password: string }
) {
  const session = await loginUserSession(
    app,
    user.email,
    user.password,
    user.orgId
  );

  return (path: string, method: string, body?: { verdict: string }) =>
    app.fetch(
      new Request(`http://localhost:4310/v1/profiles/${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method,
      })
    );
}

describe("regression case run routes", () => {
  test("a rerun stores a result linked to its case and keeps the mark", async () => {
    const { app, databaseAdapter, sent } = createApp();
    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });
    const caseId = await seedCase(databaseAdapter, admin.orgId, "agent_1");
    const call = await signIn(app, admin);

    const rerun = await call(`agent_1/regression-cases/${caseId}/runs`, "POST");

    expect(rerun.status).toBe(201);

    const { run } = await rerun.json();

    expect(sent).toEqual([
      {
        input: "Why did the deploy fail?",
        orgId: admin.orgId,
        profileId: "agent_1",
      },
    ]);
    expect(run).toMatchObject({
      caseId,
      createdByUserId: admin.userId,
      error: null,
      output: "Health check failed on the new pods.",
      status: "completed",
      verdict: null,
    });

    const badMark = await call(
      `agent_1/regression-cases/${caseId}/runs/${run.id}`,
      "PATCH",
      { verdict: "maybe" }
    );

    expect(badMark.status).toBe(400);

    const mark = await call(
      `agent_1/regression-cases/${caseId}/runs/${run.id}`,
      "PATCH",
      { verdict: "pass" }
    );

    expect(mark.status).toBe(200);
    expect((await mark.json()).run).toMatchObject({
      id: run.id,
      verdict: "pass",
      verdictByUserId: admin.userId,
    });
    expect(
      await databaseAdapter.getRegressionCaseRun(admin.orgId, caseId, run.id)
    ).toMatchObject({ verdict: "pass", verdictByUserId: admin.userId });
  });

  test("a run that fails after it starts is stored and cannot be marked", async () => {
    const { agent, app, databaseAdapter } = createApp();
    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });
    const caseId = await seedCase(databaseAdapter, admin.orgId, "agent_1");
    const call = await signIn(app, admin);

    agent.runRegressionCase = () =>
      Promise.resolve({ error: "The rerun failed.", output: null });

    const rerun = await call(`agent_1/regression-cases/${caseId}/runs`, "POST");

    expect(rerun.status).toBe(201);

    const { run } = await rerun.json();

    expect(run).toMatchObject({ output: null, status: "failed" });

    const mark = await call(
      `agent_1/regression-cases/${caseId}/runs/${run.id}`,
      "PATCH",
      { verdict: "pass" }
    );

    expect(mark.status).toBe(409);
    expect(
      await databaseAdapter.getRegressionCaseRun(admin.orgId, caseId, run.id)
    ).toMatchObject({ verdict: null });
  });

  test("a second rerun of the same case waits for the first", async () => {
    const { agent, app, databaseAdapter } = createApp();
    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });
    const caseId = await seedCase(databaseAdapter, admin.orgId, "agent_1");
    const call = await signIn(app, admin);
    let finish = () => {};

    agent.runRegressionCase = () =>
      new Promise((resolve) => {
        finish = () => resolve({ error: null, output: "Done." });
      });

    const first = call(`agent_1/regression-cases/${caseId}/runs`, "POST");

    await Bun.sleep(10);

    const second = await call(
      `agent_1/regression-cases/${caseId}/runs`,
      "POST"
    );

    expect(second.status).toBe(409);

    finish();
    expect((await first).status).toBe(201);

    agent.runRegressionCase = () =>
      Promise.resolve({ error: null, output: "Again." });

    expect(
      (await call(`agent_1/regression-cases/${caseId}/runs`, "POST")).status
    ).toBe(201);
  });

  test("an ACP agent profile is refused and no run is stored", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const agent = new AgentService(null, null, databaseAdapter);

    // A configured provider leaves the ACP check as the only refusal.
    Reflect.set(agent, "_providerConfigured", true);

    const { app } = createMinimalHonoApp({
      agent,
      authService: new AuthService(),
      databaseAdapter,
    });

    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });

    const profile = await databaseAdapter.getProfileForOrg(
      "agent_1",
      admin.orgId
    );

    await databaseAdapter.upsertProfile({
      ...profile!,
      acpAgent: { args: [], command: "opencode" },
    });

    const caseId = await seedCase(databaseAdapter, admin.orgId, "agent_1");
    const call = await signIn(app, admin);

    const rerun = await call(`agent_1/regression-cases/${caseId}/runs`, "POST");

    expect(rerun.status).toBe(409);
  });

  test("a member of another org cannot rerun or mark the case", async () => {
    const { app, databaseAdapter, sent } = createApp();

    const orgA = await seedOrgAdmin(databaseAdapter, {
      email: "a@example.com",
      orgId: "org_a",
      profileId: "agent_a",
      userId: "user_a",
    });

    const orgB = await seedOrgAdmin(databaseAdapter, {
      email: "b@example.com",
      orgId: "org_b",
      profileId: "agent_b",
      userId: "user_b",
    });

    const caseId = await seedCase(databaseAdapter, orgA.orgId, "agent_a");
    const callA = await signIn(app, orgA);
    const callB = await signIn(app, orgB);

    const { run } = await (
      await callA(`agent_a/regression-cases/${caseId}/runs`, "POST")
    ).json();

    for (const profileId of ["agent_a", "agent_b"]) {
      const rerun = await callB(
        `${profileId}/regression-cases/${caseId}/runs`,
        "POST"
      );

      expect(rerun.status).toBe(404);

      const mark = await callB(
        `${profileId}/regression-cases/${caseId}/runs/${run.id}`,
        "PATCH",
        { verdict: "fail" }
      );

      expect(mark.status).toBe(404);
    }

    expect(sent).toHaveLength(1);
    expect(
      await databaseAdapter.getRegressionCaseRun(orgA.orgId, caseId, run.id)
    ).toMatchObject({ verdict: null });
  });
});
