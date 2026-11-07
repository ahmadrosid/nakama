import { afterEach, describe, expect, test } from "bun:test";
import {
  loadLocalAuthToken,
  readEnvValue,
  setManagedSecretResolver,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { createHonoApp } from "../app";
import { seedLocalClientUser } from "../test-org-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

const URL_BASE = "http://localhost:4310/v1/internal/channel-bot-token";

function createServerOptions() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  return {
    // SAFETY: This test controls the fixture shape at this boundary.
    agent: {} as any,
    authService,
    // SAFETY: This test controls the fixture shape at this boundary.
    automationService: {} as any,
    databaseAdapter,
    // SAFETY: This test controls the fixture shape at this boundary.
    mcpService: {} as any,
    orgService: new OrgService(databaseAdapter, authService),
    // SAFETY: This test controls the fixture shape at this boundary.
    skillCuratorService: {} as any,
    // SAFETY: This test controls the fixture shape at this boundary.
    systemStatus: {} as any,
    webDistDir: null,
    // SAFETY: This test controls the fixture shape at this boundary.
    workerManager: {} as any,
  };
}

afterEach(() => {
  setManagedSecretResolver(
    async (_scope, _name, envNames) =>
      envNames.map((name) => readEnvValue(process.env, name)).find(Boolean) ??
      null
  );
});

describe("internal channel bot token route", () => {
  test("gives a worker its bot token and nothing else", async () => {
    const secrets = new Map([
      ["org_a/telegram-bot:agent_a", "111:AAA"],
      ["global/email", "mail-password"],
    ]);

    setManagedSecretResolver(
      async (scope, name) => secrets.get(`${scope}/${name}`) ?? null
    );

    const options = createServerOptions();
    await seedLocalClientUser(options.databaseAdapter);
    const app = createHonoApp(options);

    const headers = { Authorization: `Bearer ${await loadLocalAuthToken()}` };

    const token = await app.fetch(
      new Request(`${URL_BASE}?scope=org_a&name=telegram-bot:agent_a`, {
        headers,
      })
    );

    expect(token.status).toBe(200);
    expect(await token.json()).toEqual({ token: "111:AAA" });

    const email = await app.fetch(
      new Request(`${URL_BASE}?scope=global&name=email`, { headers })
    );

    expect(email.status).toBe(404);
  });

  // The auth middleware already 401s an unauthenticated caller, so the route's
  // own local-token check is what keeps a signed-in browser session out.
  test("keeps a browser session out", async () => {
    setManagedSecretResolver(async () => "111:AAA");

    const options = createServerOptions();
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const response = await app.fetch(
      new Request(`${URL_BASE}?scope=org_a&name=telegram-bot:agent_a`, {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(401);
  });
});
