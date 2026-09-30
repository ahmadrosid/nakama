import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListBrowserSessionsResponse } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
  type TestBrowserSession,
} from "../test-session-helpers";

const PASSWORD = "password123";

async function createApp() {
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-auth-sessions-route-")
  );

  const databaseAdapter = createInMemoryDatabaseAdapter();

  return createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    databaseAdapter,
  });
}

async function listSessions(
  app: { fetch: typeof fetch },
  session: TestBrowserSession
): Promise<ListBrowserSessionsResponse> {
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/auth/sessions", {
      headers: session.headers(),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ListBrowserSessionsResponse;
}

function revoke(
  app: { fetch: typeof fetch },
  session: TestBrowserSession,
  sessionId: string
): Promise<Response> {
  return app.fetch(
    new Request(
      `http://localhost:4310/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "DELETE",
      }
    )
  );
}

describe("browser session governance", () => {
  test("a user lists their own devices and marks the one making the request", async () => {
    const { app, databaseAdapter } = await createApp();
    const first = await setupFreshInstallSession(app, databaseAdapter);
    const second = await loginUserSession(app, "admin@example.com", PASSWORD);

    const listed = await listSessions(app, second);

    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions.filter((entry) => entry.current)).toHaveLength(1);
    // Nothing that authenticates a session may leave the database.
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain("TokenHash");
    expect(serialized).not.toContain(second.csrfToken);
    void first;
  });

  test("a user revokes another of their sessions and its cookie stops working", async () => {
    const { app, databaseAdapter } = await createApp();
    await setupFreshInstallSession(app, databaseAdapter);
    const keep = await loginUserSession(app, "admin@example.com", PASSWORD);
    const doomed = await loginUserSession(app, "admin@example.com", PASSWORD);

    // Ask the doomed session which row is its own, so the revoke targets it
    // rather than whichever session happens to sort first.
    const doomedOwn = await listSessions(app, doomed);
    const doomedId =
      doomedOwn.sessions.find((entry) => entry.current)?.id ?? "";
    expect(doomedId).not.toBe("");

    const response = await revoke(app, keep, doomedId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: 1 });

    const afterRevoke = await app.fetch(
      new Request("http://localhost:4310/v1/auth/sessions", {
        headers: doomed.headers(),
      })
    );
    expect(afterRevoke.status).toBe(401);

    // The caller's own session is untouched, and the revoked row is gone.
    const remaining = await listSessions(app, keep);
    expect(remaining.sessions.map((entry) => entry.id)).not.toContain(doomedId);
    expect(remaining.sessions.some((entry) => entry.current)).toBe(true);
  });

  test("one user cannot revoke another user's session", async () => {
    const { app, databaseAdapter } = await createApp();
    const owner = await setupFreshInstallSession(app, databaseAdapter);
    const ownerSessions = await listSessions(app, owner);
    const ownerSessionId = ownerSessions.sessions[0]?.id ?? "";

    const intruderEmail = "intruder@example.com";
    await seedOrgAdmin(databaseAdapter, {
      email: intruderEmail,
      orgId: "org_intruder",
      userId: "user_intruder",
    });
    const intruder = await loginUserSession(app, intruderEmail, PASSWORD);

    const response = await revoke(app, intruder, ownerSessionId);

    // A session that is not yours reads the same as one that is not there, so
    // an id cannot be probed against another account.
    expect(response.status).toBe(404);
    const stillThere = await listSessions(app, owner);
    expect(stillThere.sessions.map((entry) => entry.id)).toContain(
      ownerSessionId
    );
  });

  test("an API key cannot list human browser sessions", async () => {
    const { app, authService, databaseAdapter } = await createApp();
    const owner = await setupFreshInstallSession(app, databaseAdapter);
    const user = await databaseAdapter.getUserByEmail("admin@example.com");
    if (!(user && owner.orgId)) {
      throw new Error("Expected setup admin");
    }

    const secret = `nk_live_${"d".repeat(64)}`;
    await databaseAdapter.createApiKey({
      createdAt: new Date().toISOString(),
      createdByUserId: user.id,
      environment: "live",
      expiresAt: null,
      id: "key_auth_sessions_list",
      keyPrefix: secret.slice(0, 20),
      lastUsedAt: null,
      name: "Auth sessions list test",
      orgId: owner.orgId,
      revokedAt: null,
      secretHash: authService.hashToken(secret),
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/sessions", {
        headers: { Authorization: `Bearer ${secret}` },
      })
    );

    expect(response.status).toBe(403);
    const ownerSessions = await listSessions(app, owner);
    expect(ownerSessions.sessions.some((entry) => entry.current)).toBe(true);
  });

  test("an API key cannot revoke a human browser session", async () => {
    const { app, authService, databaseAdapter } = await createApp();
    const owner = await setupFreshInstallSession(app, databaseAdapter);
    const ownerSessions = await listSessions(app, owner);
    const ownerSessionId = ownerSessions.sessions[0]?.id ?? "";
    const user = await databaseAdapter.getUserByEmail("admin@example.com");
    if (!ownerSessionId) {
      throw new Error("Expected setup admin and browser session");
    }
    if (!user) {
      throw new Error("Expected setup admin and browser session");
    }
    if (!owner.orgId) {
      throw new Error("Expected setup admin and browser session");
    }

    const secret = `nk_live_${"e".repeat(64)}`;
    await databaseAdapter.createApiKey({
      createdAt: new Date().toISOString(),
      createdByUserId: user.id,
      environment: "live",
      expiresAt: null,
      id: "key_auth_sessions_revoke",
      keyPrefix: secret.slice(0, 20),
      lastUsedAt: null,
      name: "Auth sessions revoke test",
      orgId: owner.orgId,
      revokedAt: null,
      secretHash: authService.hashToken(secret),
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/auth/sessions/${encodeURIComponent(ownerSessionId)}`,
        {
          headers: { Authorization: `Bearer ${secret}` },
          method: "DELETE",
        }
      )
    );

    expect(response.status).toBe(403);
    const remaining = await listSessions(app, owner);
    expect(remaining.sessions.map((entry) => entry.id)).toContain(
      ownerSessionId
    );
  });

  test("a platform admin force-revokes every session a user holds", async () => {
    const { app, databaseAdapter } = await createApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    await loginUserSession(app, "admin@example.com", PASSWORD);
    const victim = await databaseAdapter.getUserByEmail("admin@example.com");
    expect(victim).not.toBeNull();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/auth/users/${encodeURIComponent(victim?.id ?? "")}/sessions`,
        {
          headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
          method: "DELETE",
        }
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { revoked: number };
    expect(body.revoked).toBeGreaterThanOrEqual(2);
  });
  test("an org admin who is not a platform admin cannot force-revoke anyone", async () => {
    const { app, databaseAdapter } = await createApp();
    const owner = await setupFreshInstallSession(app, databaseAdapter);
    const victim = await databaseAdapter.getUserByEmail("admin@example.com");

    await seedOrgAdmin(databaseAdapter, {
      email: "orgadmin@example.com",
      orgId: "org_other",
      userId: "user_orgadmin",
    });
    const orgAdmin = await loginUserSession(
      app,
      "orgadmin@example.com",
      PASSWORD
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/auth/users/${encodeURIComponent(victim?.id ?? "")}/sessions`,
        {
          headers: orgAdmin.headers({ "X-CSRF-Token": orgAdmin.csrfToken }),
          method: "DELETE",
        }
      )
    );

    expect(response.status).toBe(403);
    // Refused, not partially applied: the owner is still signed in.
    const stillLive = await listSessions(app, owner);
    expect(stillLive.sessions.length).toBeGreaterThan(0);
  });
});
