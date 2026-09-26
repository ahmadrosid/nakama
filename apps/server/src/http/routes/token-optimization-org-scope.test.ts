import { describe, expect, test } from "bun:test";
import {
  createInMemoryDatabaseAdapter,
  mergeWorkspaceSettings,
} from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import type { TestBrowserSession } from "../test-session-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-token-optimization-org-scope-test-");

const PASSWORD = "password123";
const ORG_A = "opt_org_a";
const ORG_B = "opt_org_b";

/**
 * The optimiser flag is one column on the single `workspace_settings` row, and
 * every session in every org resolves through it. So the ownership contract is
 * install-wide: platform admins write it, org admins read their own org's
 * measurements. These tests hold both halves, with two orgs so a per-org leak
 * would be visible rather than hidden by a single tenant.
 */
async function createFixture() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({ databaseAdapter });

  for (const id of ["a", "b"] as const) {
    await seedOrgAdmin(databaseAdapter, {
      authService,
      email: `${id}@optimizer.test`,
      orgId: id === "a" ? ORG_A : ORG_B,
      password: PASSWORD,
      userId: `opt_user_${id}`,
    });
  }

  // Known starting point: the optimiser is on install-wide.
  await databaseAdapter.upsertWorkspaceSettings(
    mergeWorkspaceSettings(null, {
      tokenOptimizerEnabled: true,
      updatedAt: new Date().toISOString(),
    })
  );

  const orgAdminA = await loginUserSession(
    app,
    "a@optimizer.test",
    PASSWORD,
    ORG_A
  );
  const orgAdminB = await loginUserSession(
    app,
    "b@optimizer.test",
    PASSWORD,
    ORG_B
  );

  // A platform admin who also belongs to org A, which is the shape the route
  // has to keep working for.
  const now = new Date().toISOString();
  await databaseAdapter.createUser({
    createdAt: now,
    email: "platform@optimizer.test",
    id: "opt_user_platform",
    isPlatformAdmin: true,
    passwordHash: await authService.hashPassword(PASSWORD),
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId: ORG_A,
    role: "admin",
    userId: "opt_user_platform",
  });
  const platformAdmin = await loginUserSession(
    app,
    "platform@optimizer.test",
    PASSWORD,
    ORG_A
  );

  return { app, databaseAdapter, orgAdminA, orgAdminB, platformAdmin };
}

function call(
  app: { fetch: typeof fetch },
  session: TestBrowserSession,
  method: "GET" | "PUT",
  body?: unknown
) {
  return app.fetch(
    new Request("http://localhost:4310/v1/token-optimization", {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method,
    })
  );
}

async function installedFlag(
  app: { fetch: typeof fetch },
  session: TestBrowserSession
) {
  const response = await call(app, session, "GET");
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    optimizers: Array<{ enabled: boolean }>;
  };
  return body.optimizers[0]?.enabled;
}

describe("install-wide token optimiser writes", () => {
  for (const [label, sessionKey] of [
    ["org A", "orgAdminA"],
    ["org B", "orgAdminB"],
  ] as const) {
    test(`${label} admin cannot turn the install-wide optimiser off`, async () => {
      const fixture = await createFixture();

      const response = await call(fixture.app, fixture[sessionKey], "PUT", {
        enabled: false,
      });

      expect(response.status).toBe(403);
      // Rejected before the shared row is touched, so the other tenant keeps
      // the setting it had.
      expect(
        (await fixture.databaseAdapter.getWorkspaceSettings())
          ?.tokenOptimizerEnabled
      ).toBe(true);
    });

    test(`${label} admin still reads its own panel`, async () => {
      const fixture = await createFixture();

      expect(await installedFlag(fixture.app, fixture[sessionKey])).toBe(true);
    });
  }

  test("a platform admin writes it and both orgs observe the change", async () => {
    const fixture = await createFixture();

    const response = await call(fixture.app, fixture.platformAdmin, "PUT", {
      enabled: false,
    });

    expect(response.status).toBe(200);
    expect(
      (await fixture.databaseAdapter.getWorkspaceSettings())
        ?.tokenOptimizerEnabled
    ).toBe(false);
    expect(await installedFlag(fixture.app, fixture.orgAdminA)).toBe(false);
    expect(await installedFlag(fixture.app, fixture.orgAdminB)).toBe(false);
  });

  test("an org admin cannot re-enable what a platform admin turned off", async () => {
    const fixture = await createFixture();
    const write = await call(fixture.app, fixture.platformAdmin, "PUT", {
      enabled: false,
    });
    expect(write.status).toBe(200);

    const response = await call(fixture.app, fixture.orgAdminB, "PUT", {
      enabled: true,
    });

    expect(response.status).toBe(403);
    expect(
      (await fixture.databaseAdapter.getWorkspaceSettings())
        ?.tokenOptimizerEnabled
    ).toBe(false);
  });
});
