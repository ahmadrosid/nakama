import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { SkillsService } from "../../services/skills-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-skills-install-routes-test-");

const VALID_SKILL = `---
name: github-weather
description: Get weather from a public GitHub skill.
---

Call the weather tool.
`;

const INVALID_SKILL = `# No frontmatter

Just a body.
`;

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const skillsService = new SkillsService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
        installSkillFromGitHub: (orgId: string, request: unknown) =>
          skillsService.installSkillFromGitHub(
            orgId,
            request as { profileId: string; url: string }
          ),
        listProfiles: async () => ({ profiles: [] }),
      },
      databaseAdapter,
    }),
    skillsService,
  };
}

const BASE = "http://localhost:4310";

describe("POST /v1/skills/install", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("platform admin installs a valid public SKILL.md and assigns it", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(
        "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
      );
      return new Response(VALID_SKILL, { status: 200 });
    }) as typeof fetch;

    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin@org.com"
    );
    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;

    const response = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({
          profileId,
          url: "https://github.com/acme/skills/blob/main/weather/SKILL.md",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      skill: { name: string; id: string };
    };
    expect(body.skill.name).toBe("github-weather");

    const assigned = await databaseAdapter.listSkillsForProfile(profileId);
    expect(assigned.some((skill) => skill.id === body.skill.id)).toBe(true);
  });

  test("invalid frontmatter returns 400 and writes no skill", async () => {
    globalThis.fetch = mock(
      async () => new Response(INVALID_SKILL, { status: 200 })
    ) as typeof fetch;

    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin@org.com"
    );
    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;
    const before = await databaseAdapter.listSkills();

    const response = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({
          profileId,
          url: "https://github.com/acme/skills/blob/main/broken/SKILL.md",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    const after = await databaseAdapter.listSkills();
    expect(after).toHaveLength(before.length);
  });

  test("non-GitHub URL returns 400", async () => {
    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin@org.com"
    );
    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;

    const response = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({
          profileId,
          url: "https://example.com/skills/weather/SKILL.md",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/GitHub/i);
  });

  test("non-admin returns 403", async () => {
    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin@org.com"
    );
    const orgId = adminSession.orgId!;

    const memberResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@org.com",
          name: "Member",
          role: "member",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );
    const memberProvisioned = (await memberResp.json()) as {
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member@org.com",
      memberProvisioned.temporaryPassword,
      orgId
    );
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const profileId = profiles[0]!.id;

    const response = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({
          profileId,
          url: "https://github.com/acme/skills/blob/main/weather/SKILL.md",
        }),
        headers: memberSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": memberSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
  });

  test("incomplete body returns 400, not 500", async () => {
    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-malformed@org.com"
    );
    const orgId = adminSession.orgId!;

    const response = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({ profileId: "p" }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/url is required/i);
  });

  test("installing the same skill onto a second profile returns 409", async () => {
    globalThis.fetch = mock(
      async () => new Response(VALID_SKILL, { status: 200 })
    ) as typeof fetch;

    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin-dup@org.com"
    );
    const orgId = adminSession.orgId!;
    const profiles = await databaseAdapter.listProfilesForOrg(orgId);
    const firstProfileId = profiles[0]!.id;

    const first = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({
          profileId: firstProfileId,
          url: "https://github.com/acme/skills/blob/main/weather/SKILL.md",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );
    expect(first.status).toBe(201);

    const now = new Date().toISOString();
    const secondProfileId = "profile_second";
    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: secondProfileId,
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Second",
      orgId,
      skillsPostTurnReview: false,
      skillsWriteApproval: false,
      systemPrompt: "",
      updatedAt: now,
    });

    const second = await app.fetch(
      new Request(`${BASE}/v1/skills/install`, {
        body: JSON.stringify({
          profileId: secondProfileId,
          url: "https://github.com/acme/skills/blob/main/weather/SKILL.md",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/already exists|cannot be attached/i);
  });
});
