import { describe, expect, test } from "bun:test";
import { loadLocalAuthToken } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import { seedLocalClientUser } from "../test-org-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

const ORG_ID = "org_default";

function createServerOptions() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  return {
    agent: {} as any,
    authService,
    automationService: {} as any,
    databaseAdapter,
    mcpService: {} as any,
    orgService: new OrgService(databaseAdapter, authService),
    skillCuratorService: {} as any,
    systemStatus: {} as any,
    webDistDir: null,
    workerManager: {} as any,
  };
}

async function seedCuratorOrg(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
): Promise<void> {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Default Org",
    skillsCuratorEnabled: true,
    slug: "default-org",
    updatedAt: now,
  });
}

describe("internal curator routes", () => {
  test("lists curator orgs for local-token auth", async () => {
    const options = createServerOptions();
    await seedCuratorOrg(options.databaseAdapter);
    await seedLocalClientUser(options.databaseAdapter);

    const app = createHonoApp(options);
    const token = await loadLocalAuthToken();

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/internal/curator/orgs", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orgs).toEqual([
      { id: ORG_ID, skillsCuratorEnabled: true, skillsCuratorLastRunAt: null },
    ]);
  });

  // The auth middleware already 401s an unauthenticated caller, so the only thing
  // the route's local-token check does is keep a signed-in browser session out.
  // Both cases below fail if that check is removed.
  test("keeps a browser session out of the curator endpoints", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);
    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const list = await app.fetch(
      new Request("http://localhost:4310/v1/internal/curator/orgs", {
        headers: session.headers(),
      })
    );
    expect(list.status).toBe(401);

    const run = await app.fetch(
      new Request(
        `http://localhost:4310/v1/internal/curator/orgs/${session.orgId}/run`,
        {
          body: JSON.stringify({ trigger: "schedule" }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(run.status).toBe(401);
  });
});
