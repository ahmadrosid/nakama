import { expect, test } from "bun:test";
import type { SetupChecklistResponse } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { SkillsService } from "../../services/skills-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-user-context-routes-test-");

const ORG_ID = "org_checklist";

const PROFILE_ID = "profile_checklist";

async function loginMember() {
  const db = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, db);
  agent.setSkillsService(new SkillsService(db));

  const { app, authService } = createMinimalHonoApp({
    agent,
    databaseAdapter: db,
  });

  const seeded = await seedOrgAdmin(db, {
    authService,
    orgId: ORG_ID,
    profileId: PROFILE_ID,
    role: "member",
  });

  const session = await loginUserSession(
    app,
    seeded.email,
    seeded.password,
    ORG_ID
  );

  const call = (method: string, path: string, body: Record<string, string>) =>
    app.fetch(
      new Request(`http://localhost:4310${path}`, {
        body: JSON.stringify(body),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method,
      })
    );

  return { call };
}

test("setup checklist returns the saved goal for a member", async () => {
  const { call } = await loginMember();

  await call("PUT", "/v1/user/context", {
    content: "# About Me\n\n- Help with: Manage my Meta Ads\n",
  });

  const response = await call("POST", "/v1/user/setup-checklist", {
    profileId: PROFILE_ID,
  });

  expect(response.status).toBe(200);

  // SAFETY: A 200 from this route is a SetupChecklistResponse.
  const body = (await response.json()) as SetupChecklistResponse;

  // No provider in tests, so the model picks nothing.
  expect(body).toEqual({ goal: "Manage my Meta Ads", items: [] });
});

test("setup checklist rejects an agent outside the org", async () => {
  const { call } = await loginMember();

  const response = await call("POST", "/v1/user/setup-checklist", {
    profileId: "profile_elsewhere",
  });

  expect(response.status).toBe(404);
});
