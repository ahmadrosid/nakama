import { afterEach, describe, expect, test } from "bun:test";
import type { TeamsActivity } from "./chat-handler";
import { startTeamsApp, type TeamsAppHandle } from "./teams-app";

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
});
