import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-profile-avatar-org-scope-test-");

const PASSWORD = "password123";
const ATTACKER_ORG = "org_attacker";
const VICTIM_ORG = "org_victim";
const VICTIM_PROFILE = "profile_victim";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService({ providers: [] }, null, databaseAdapter);
  const { app } = createMinimalHonoApp({ agent, databaseAdapter });

  await seedOrgAdmin(databaseAdapter, {
    email: "attacker@example.com",
    orgId: ATTACKER_ORG,
    password: PASSWORD,
    userId: "user_attacker",
  });
  await seedOrgAdmin(databaseAdapter, {
    email: "victim@example.com",
    orgId: VICTIM_ORG,
    password: PASSWORD,
    profileId: VICTIM_PROFILE,
    userId: "user_victim",
  });

  await agent.uploadProfileAvatar(VICTIM_ORG, VICTIM_PROFILE, {
    data: tinyPngBase64,
    mediaType: "image/png",
  });

  return { app };
}

const AVATAR_PATH = `http://localhost:4310/v1/profiles/${VICTIM_PROFILE}/avatar`;

describe("GET /v1/profiles/:profileId/avatar is org scoped", () => {
  test("rejects anonymous callers", async () => {
    const { app } = await createScenario();

    const response = await app.fetch(new Request(AVATAR_PATH));

    expect(response.status).toBe(401);
  });

  test("hides the avatar from another org", async () => {
    const { app } = await createScenario();
    const attacker = await loginUserSession(
      app,
      "attacker@example.com",
      PASSWORD,
      ATTACKER_ORG
    );

    const response = await app.fetch(
      new Request(AVATAR_PATH, { headers: attacker.headers() })
    );

    expect(response.status).toBe(404);
  });

  // The web UI renders avatars in an <img> tag, which sends the session cookie
  // and no X-Org-Id header, so the org has to resolve from the session alone.
  test("serves the avatar to its own org from the session cookie alone", async () => {
    const { app } = await createScenario();
    const victim = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );

    const response = await app.fetch(
      new Request(AVATAR_PATH, { headers: { Cookie: victim.cookieHeader } })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });
});
