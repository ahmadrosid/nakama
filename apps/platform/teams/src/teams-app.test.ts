import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createServer } from "node:http";
import { ExpressAdapter } from "@microsoft/teams.apps";
import type { TeamsActivity } from "./chat-handler";
import {
  createSafeLogger,
  createTeamsSdkApp,
  startTeamsApp,
  type TeamsAppHandle,
} from "./teams-app";

const CONFIG = {
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "teams-secret",
  tenantId: "33333333-3333-4333-8333-333333333333",
};

const MESSAGE = {
  channelId: "msteams",
  conversation: { conversationType: "personal", id: "conv_1" },
  from: {
    aadObjectId: "11111111-1111-4111-8111-111111111111",
    id: "u1",
    role: "user",
  },
  id: "act_1",
  recipient: { id: "bot", role: "bot" },
  serviceUrl: "https://smba.trafficmanager.net/teams/",
  text: "hello",
  type: "message",
};

const handles: TeamsAppHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.stop();
  }

  delete process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS;
  delete process.env.SERVICE_URL;
});

async function start() {
  const received: TeamsActivity[] = [];

  const handle = await startTeamsApp({
    config: CONFIG,
    onActivity: async (activity) => {
      received.push(activity);
    },
  });

  handles.push(handle);

  return { handle, received };
}

function post(port: number, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}/api/messages`, {
    body: JSON.stringify(MESSAGE),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });
}

describe("teams app host", () => {
  test("listens on loopback only", async () => {
    const { handle } = await start();

    expect(handle.address).toBe("127.0.0.1");
    expect(handle.port).toBeGreaterThan(0);
  });

  test("a request without a service token never reaches the handler", async () => {
    const { handle, received } = await start();

    const response = await post(handle.port);

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  });

  test("a malformed token never reaches the handler", async () => {
    const { handle, received } = await start();

    const response = await post(handle.port, {
      Authorization: "Bearer not-a-jwt",
    });

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  });

  test("the environment cannot switch authentication off", async () => {
    process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS = "true";

    const { handle, received } = await start();

    const response = await post(handle.port);

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  });

  test("stop closes the listener", async () => {
    const { handle } = await start();
    const { port } = handle;

    await handle.stop();
    handles.splice(handles.indexOf(handle), 1);

    await expect(post(port)).rejects.toThrow();
  });

  test("replies go to Microsoft's service even when SERVICE_URL names another host", async () => {
    // The SDK sends the bot's token with every reply to this address.
    process.env.SERVICE_URL = "https://attacker.example.com/teams";

    const logger = createSafeLogger();

    const app = createTeamsSdkApp(
      { config: CONFIG },
      new ExpressAdapter(createServer(), { logger }),
      logger
    );

    expect(app.api.serviceUrl).toBe("https://smba.trafficmanager.net/teams");
  });

  test("the SDK log keeps only message text, never the objects beside it", () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const warnings = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const logger = createSafeLogger();

      logger.error("Error processing activity:", {
        headers: { authorization: "Bearer teams-service-token" },
      });
      logger.error({ clientSecret: "teams-secret" });
      logger.warn("token refresh", "teams-secret");
      logger.info("Handling activity", { text: "private message" });

      expect(errors.mock.calls).toEqual([
        ["[teams-sdk] Error processing activity:"],
      ]);
      expect(warnings.mock.calls).toEqual([["[teams-sdk] token refresh"]]);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });
});
