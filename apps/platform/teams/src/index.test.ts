import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { withTempHome } from "@nakama/core/channel-test-helpers";
import {
  loadTeamsConfigFile,
  saveTeamsConfig,
  saveTeamsInboundPort,
} from "@nakama/core/teams-config";
import { createTeamsWorkerHeartbeat } from "@nakama/core/teams-worker";

const OWNER = { orgId: "org_test", profileId: "agent_teams" };

const LIVE_PORT = 4242;

/** Saving asks Microsoft for a token; only that call is stubbed. */
async function saveWithTokenEndpointStubbed() {
  const original = globalThis.fetch;

  // SAFETY: The stub takes the same inputs as fetch and delegates everything
  // that is not the Microsoft token endpoint to the real one.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input).startsWith(
      "https://login.microsoftonline.com/"
    )
      ? Response.json({ access_token: "token", token_type: "Bearer" })
      : // SAFETY: Narrowed from the fetch input union the caller passed in.
        original(input as RequestInfo, init)) as typeof fetch;

  try {
    await saveTeamsConfig(
      {
        allowedUserIds: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
        clientSecret: "teams-secret",
        tenantId: "33333333-3333-4333-8333-333333333333",
      },
      OWNER
    );
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Runs the worker entry for OWNER. A dead proxy makes its Microsoft credential
 * check fail at once, so the test never reaches the network.
 */
function spawnWorker() {
  return Bun.spawn({
    cmd: [
      process.execPath,
      "--no-install",
      fileURLToPath(new URL("./index.ts", import.meta.url)),
    ],
    env: {
      ...process.env,
      HTTPS_PROXY: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      NAKAMA_CHANNEL_ORG_ID: OWNER.orgId,
      NAKAMA_CHANNEL_PROFILE_ID: OWNER.profileId,
      NO_PROXY: "",
      no_proxy: "",
    },
    stderr: "ignore",
    stdout: "ignore",
  });
}

test("a second worker that refuses to start leaves the running worker's port alone", async () => {
  await withTempHome("nakama-teams-entry-", async () => {
    await saveWithTokenEndpointStubbed();

    // The running worker: this test process holds the lock, a fresh
    // heartbeat, and the port it listens on.
    const running = createTeamsWorkerHeartbeat(OWNER);
    await running.acquire();

    try {
      await saveTeamsInboundPort(LIVE_PORT, OWNER);
      await running.write(true);

      // A worker that got past the lock would own the connection and clear
      // the port on exit, so a kept port means the lock refused it.
      expect(await spawnWorker().exited).toBe(1);
      expect((await loadTeamsConfigFile(OWNER))?.inboundPort).toBe(LIVE_PORT);
      expect((await running.read())?.pid).toBe(process.pid);
    } finally {
      await running.clear();
    }
  });
});

test("a fresh heartbeat whose pid now belongs to another process does not block a new worker", async () => {
  await withTempHome("nakama-teams-entry-", async () => {
    await saveWithTokenEndpointStubbed();

    // After a restart the old heartbeat names a live pid (this test process)
    // that holds no lock.
    await saveTeamsInboundPort(LIVE_PORT, OWNER);
    await createTeamsWorkerHeartbeat(OWNER).write(true);

    // The credential check fails later, but only a worker that took the
    // connection clears its port on exit.
    await spawnWorker().exited;
    expect((await loadTeamsConfigFile(OWNER))?.inboundPort).toBeNull();
  });
});
