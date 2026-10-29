import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createTeamsWorkerHeartbeat,
  saveTeamsConfig,
  saveTeamsInboundPort,
} from "@nakama/core";
import { getTeamsConfigPath } from "@nakama/core/teams-config";
import { setupTestConfigDir } from "../../test-config-dir";
import {
  CREDENTIALS,
  setupOwnedProfile,
  withTokenEndpointStubbed,
} from "../test-teams-helpers";

setupTestConfigDir("nakama-teams-proxy-test-");

const servers: { stop: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

/** A stand-in for the worker's SDK listener, bound to loopback like the real one. */
function startFakeWorker(
  handler: (request: Request) => Response | Promise<Response>
) {
  const server = Bun.serve({ fetch: handler, hostname: "127.0.0.1", port: 0 });

  servers.push(server);

  if (server.port === undefined) {
    throw new Error("The fake worker did not bind a port.");
  }

  return { port: server.port };
}

describe("teams webhook proxy", () => {
  async function configureLiveWorker(
    profileId: string,
    handler: (request: Request) => Response | Promise<Response>,
    credentials = CREDENTIALS
  ) {
    const owner = { orgId: "org_test", profileId };

    await withTokenEndpointStubbed(() => saveTeamsConfig(credentials, owner));

    const server = startFakeWorker(handler);

    await saveTeamsInboundPort(server.port, owner);
    await createTeamsWorkerHeartbeat(owner).write(true);

    return server;
  }

  test("forwards the body and the Authorization header to the owner's worker", async () => {
    const { app, profileId } = await setupOwnedProfile();

    const seen: { auth: string | null; body: string; cookie: string | null }[] =
      [];

    await configureLiveWorker(profileId, async (request) => {
      seen.push({
        auth: request.headers.get("authorization"),
        body: await request.text(),
        cookie: request.headers.get("cookie"),
      });

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ text: "hello", type: "message" }),
          headers: {
            Authorization: "Bearer teams-service-token",
            "Content-Type": "application/json",
            Cookie: "nakama_session=should-not-be-forwarded",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.auth).toBe("Bearer teams-service-token");
    expect(JSON.parse(String(seen[0]?.body))).toEqual({
      text: "hello",
      type: "message",
    });
    expect(seen[0]?.cookie).toBeNull();
  });

  test("refuses when the worker is not running, even with a saved port", async () => {
    const { app, profileId } = await setupOwnedProfile();
    const owner = { orgId: "org_test", profileId };
    let reached = false;

    await withTokenEndpointStubbed(() => saveTeamsConfig(CREDENTIALS, owner));

    const server = startFakeWorker(() => {
      reached = true;

      return Response.json({ ok: true });
    });

    await saveTeamsInboundPort(server.port, owner);
    await createTeamsWorkerHeartbeat(owner).clear();

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(503);
    expect(reached).toBe(false);
  });

  test("ignores an organization chosen by the caller", async () => {
    const { app, profileId } = await setupOwnedProfile();
    let reached = 0;

    await configureLiveWorker(profileId, () => {
      reached += 1;

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages?orgId=org_attacker`,
        {
          body: JSON.stringify({ orgId: "org_attacker", type: "message" }),
          headers: {
            "Content-Type": "application/json",
            "X-Org-Id": "org_attacker",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(reached).toBe(1);
  });

  // An unauthenticated caller cannot tell an unknown agent, an unreadable
  // configuration or a stopped worker apart.
  test("refuses an unknown agent the way it refuses a stopped worker", async () => {
    const { app } = await setupOwnedProfile();

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/channels/teams/profile_missing/messages",
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(503);
  });

  test("an agent id that decodes to a stray percent sign is refused, not an error", async () => {
    const { app } = await setupOwnedProfile();

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/channels/teams/a%25b/messages", {
        body: JSON.stringify({ type: "message" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(503);
  });

  test("an unreadable configuration is refused, not an error", async () => {
    const { app, profileId } = await setupOwnedProfile();

    await mkdir(dirname(getTeamsConfigPath({ orgId: "org_test", profileId })), {
      recursive: true,
    });
    await writeFile(
      getTeamsConfigPath({ orgId: "org_test", profileId }),
      "not a teams configuration"
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(503);
  });

  test("refuses an archived organization's agent even with a live worker", async () => {
    const { app, databaseAdapter, profileId } = await setupOwnedProfile();
    let reached = false;

    await configureLiveWorker(profileId, () => {
      reached = true;

      return Response.json({ ok: true });
    });

    const organization = await databaseAdapter.getOrganizationById("org_test");

    if (!organization) {
      throw new Error("The seeded organization is missing.");
    }

    await databaseAdapter.upsertOrganization({
      ...organization,
      archivedAt: new Date().toISOString(),
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(503);
    expect(reached).toBe(false);
  });

  test("refuses a declared oversized body before reading it", async () => {
    const { app, profileId } = await setupOwnedProfile();
    let reached = false;

    await configureLiveWorker(profileId, () => {
      reached = true;

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: {
            "Content-Length": "200000",
            "Content-Type": "application/json",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(413);
    expect(reached).toBe(false);
  });

  test("refuses a body larger than the forwarding limit", async () => {
    const { app, profileId } = await setupOwnedProfile();
    let reached = false;

    await configureLiveWorker(profileId, () => {
      reached = true;

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: "x".repeat(1_100_000),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(413);
    expect(reached).toBe(false);
  });

  test("does not follow a redirect the worker returns", async () => {
    const { app, profileId } = await setupOwnedProfile();

    await configureLiveWorker(
      profileId,
      () =>
        new Response(null, {
          headers: { Location: "http://169.254.169.254/latest/meta-data" },
          status: 302,
        })
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(502);
  });

  test("never relays the worker's own error page to the caller", async () => {
    const { app, profileId } = await setupOwnedProfile();

    // What express sends outside production for a body it cannot parse.
    await configureLiveWorker(
      profileId,
      () =>
        new Response(
          "<pre>SyntaxError: Unexpected token<br> &nbsp; &nbsp;at parse (/Users/someone/nakama/node_modules/body-parser/lib/types/json.js:91:21)</pre>",
          { headers: { "Content-Type": "text/html" }, status: 400 }
        )
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: "{not json",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).not.toContain("node_modules");
    expect(body).not.toContain("SyntaxError");
  });

  test("refuses a body larger than the worker's JSON parser accepts", async () => {
    const { app, profileId } = await setupOwnedProfile();
    let reached = false;

    await configureLiveWorker(profileId, () => {
      reached = true;

      return Response.json({ ok: true });
    });

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ text: "x".repeat(150_000), type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(413);
    expect(reached).toBe(false);
  });

  test("refuses a fresh heartbeat left by a worker process that has died", async () => {
    const { app, profileId } = await setupOwnedProfile();
    const owner = { orgId: "org_test", profileId };
    let reached = false;

    await withTokenEndpointStubbed(() => saveTeamsConfig(CREDENTIALS, owner));

    const server = startFakeWorker(() => {
      reached = true;

      return Response.json({ ok: true });
    });

    await saveTeamsInboundPort(server.port, owner);

    // A worker killed without its shutdown: the heartbeat is seconds old, but
    // the process that wrote it is gone.
    const heartbeatModule = import.meta.resolve("@nakama/core/teams-worker");

    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "--no-install",
        "-e",
        `const { createTeamsWorkerHeartbeat } = await import(${JSON.stringify(heartbeatModule)});
         await createTeamsWorkerHeartbeat(${JSON.stringify(owner)}).write(true);`,
      ],
      // Passed explicitly: the spawned process does not see the config dir
      // this test file set after it started.
      env: { ...process.env },
      stderr: "inherit",
      stdout: "ignore",
    });

    expect(await child.exited).toBe(0);
    expect((await createTeamsWorkerHeartbeat(owner).read())?.pid).toBe(
      child.pid
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/channels/teams/${profileId}/messages`,
        {
          body: JSON.stringify({ type: "message" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(503);
    expect(reached).toBe(false);
  });

  test("delivers only to the worker of the agent named in the path", async () => {
    const { app, databaseAdapter, profileId } = await setupOwnedProfile();
    const [first] = await databaseAdapter.listProfilesForOrg("org_test");

    if (!first) {
      throw new Error("The seeded agent is missing.");
    }

    await databaseAdapter.upsertProfile({
      ...first,
      id: "agent_teams_b",
      isDefault: false,
      name: "Agent B",
    });

    const reached: string[] = [];

    await configureLiveWorker(profileId, () => {
      reached.push(profileId);

      return Response.json({ ok: true });
    });

    // One bot registration serves one agent, so B has its own.
    await configureLiveWorker(
      "agent_teams_b",
      () => {
        reached.push("agent_teams_b");

        return Response.json({ ok: true });
      },
      { ...CREDENTIALS, clientId: "44444444-4444-4444-8444-444444444444" }
    );

    const post = (target: string) =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/channels/teams/${target}/messages`,
          {
            body: JSON.stringify({ type: "message" }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        )
      );

    expect((await post("agent_teams_b")).status).toBe(200);
    expect((await post(profileId)).status).toBe(200);
    expect(reached).toEqual(["agent_teams_b", profileId]);
  });
});
