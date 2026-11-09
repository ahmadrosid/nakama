import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profile-avatar-org-scope-test-");

const PASSWORD = "password123";

const ATTACKER_ORG = "org_attacker";

const VICTIM_ORG = "org_victim";

const VICTIM_PROFILE = "profile_victim";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const agent = new AgentService(
    { defaultProviderId: null, providers: [] },
    null,
    databaseAdapter
  );

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

  return { app, databaseAdapter };
}

const AVATAR_PATH = `http://localhost:4310/v1/profiles/${VICTIM_PROFILE}/avatar`;

describe("GET /v1/profiles/:profileId/avatar is org scoped", () => {
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

    const requestedOrg = await app.fetch(
      new Request(`${AVATAR_PATH}?orgId=${VICTIM_ORG}`, {
        headers: { Cookie: attacker.cookieHeader },
      })
    );

    expect(requestedOrg.status).toBe(404);
  });

  test("serves a remote org avatar to a platform admin by cookie", async () => {
    const { app, databaseAdapter } = await createScenario();

    const admin = await loginPlatformAdminSession(
      app,
      new AuthService(),
      databaseAdapter
    );

    const selected = await app.fetch(
      new Request("http://localhost:4310/v1/auth/active-org", {
        body: JSON.stringify({ orgId: ATTACKER_ORG }),
        headers: admin.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": admin.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(selected.status).toBe(200);

    const response = await app.fetch(
      new Request(`${AVATAR_PATH}?orgId=${VICTIM_ORG}`, {
        headers: { Cookie: admin.cookieHeader },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
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

async function seedOrgMember(
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>,
  opts: {
    email: string;
    orgId: string;
    password: string;
    userId: string;
  }
) {
  const now = new Date().toISOString();
  await databaseAdapter.createUser({
    createdAt: now,
    email: opts.email,
    id: opts.userId,
    passwordHash: await new AuthService().hashPassword(opts.password),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId: opts.orgId,
    role: "member",
    userId: opts.userId,
  });
}

const PRIVATE_ORG = "org_owner";

const PRIVATE_PROFILE = "profile_private";

const PRIVATE_AVATAR_PATH = `http://localhost:4310/v1/profiles/${PRIVATE_PROFILE}/avatar`;

async function createPrivateProfileScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const agent = new AgentService(
    { defaultProviderId: null, providers: [] },
    null,
    databaseAdapter
  );

  const now = new Date().toISOString();
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: PRIVATE_ORG,
    name: "Owner Org",
    slug: PRIVATE_ORG,
    updatedAt: now,
  });
  await seedOrgMember(databaseAdapter, {
    email: "owner@example.com",
    orgId: PRIVATE_ORG,
    password: PASSWORD,
    userId: "user_owner",
  });
  await databaseAdapter.upsertProfile({
    createdAt: now,
    id: PRIVATE_PROFILE,
    isSuper: false,
    model: "openrouter/auto",
    name: "Private",
    orgId: PRIVATE_ORG,
    ownerUserId: "user_owner",
    sharedWithTeam: false,
    systemPrompt: "You are helpful.",
    updatedAt: now,
  });
  await agent.uploadProfileAvatar(PRIVATE_ORG, PRIVATE_PROFILE, {
    data: tinyPngBase64,
    mediaType: "image/png",
  });

  await seedOrgMember(databaseAdapter, {
    email: "member@example.com",
    orgId: PRIVATE_ORG,
    password: PASSWORD,
    userId: "user_member",
  });

  const { app } = createMinimalHonoApp({ agent, databaseAdapter });

  return { app, databaseAdapter };
}

describe("GET /v1/profiles/:profileId/avatar enforces the profile read guard", () => {
  test("returns 403 to an org member without chat access to the profile", async () => {
    const { app } = await createPrivateProfileScenario();

    const member = await loginUserSession(
      app,
      "member@example.com",
      PASSWORD,
      PRIVATE_ORG
    );

    const response = await app.fetch(
      new Request(PRIVATE_AVATAR_PATH, {
        headers: { Cookie: member.cookieHeader },
      })
    );

    expect(response.status).toBe(403);
  });

  test("returns 200 to the private profile owner as an org member", async () => {
    const { app } = await createPrivateProfileScenario();

    const owner = await loginUserSession(
      app,
      "owner@example.com",
      PASSWORD,
      PRIVATE_ORG
    );

    const response = await app.fetch(
      new Request(PRIVATE_AVATAR_PATH, {
        headers: { Cookie: owner.cookieHeader },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });
});
