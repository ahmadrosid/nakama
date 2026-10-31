import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-web-push-routes-test-");

const ORG = "org_push";

interface SubscriptionBody {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);
  const { app } = createMinimalHonoApp({ agent, databaseAdapter });

  const { email, password } = await seedOrgAdmin(databaseAdapter, {
    orgId: ORG,
    profileId: "profile_push",
    userId: "user_push",
  });

  const session = await loginUserSession(app, email, password, ORG);

  const headers = session.headers({
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  });

  const call = (method: string, path: string, body?: SubscriptionBody) =>
    app.fetch(
      new Request(`http://localhost:4310${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        method,
      })
    );

  return { call };
}

describe("push routes", () => {
  test("hands out one public key and stores a browser push subscription", async () => {
    const { call } = await createScenario();

    const first = await (await call("GET", "/v1/push/public-key")).json();
    const second = await (await call("GET", "/v1/push/public-key")).json();

    expect(first.publicKey).toMatch(/^B[\w-]{86}$/);
    expect(second.publicKey).toBe(first.publicKey);

    const saved = await call("PUT", "/v1/push/subscription", {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { auth: "AAAAAAAAAAAAAAAAAAAAAA", p256dh: "BAAA" },
    });

    expect(saved.status).toBe(204);
  });

  test("refuses an endpoint that is not a browser push service", async () => {
    const { call } = await createScenario();

    const response = await call("PUT", "/v1/push/subscription", {
      endpoint: "https://127.0.0.1:4310/v1/sessions",
      keys: { auth: "AAAAAAAAAAAAAAAAAAAAAA", p256dh: "BAAA" },
    });

    expect(response.status).toBe(400);
  });
});
