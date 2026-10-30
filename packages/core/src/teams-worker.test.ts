import { afterEach, expect, test } from "bun:test";
import { asTestFetch, withTempHome } from "./channel-test-helpers";
import { saveTeamsConfig, saveTeamsInboundPort } from "./teams-config";
import {
  createTeamsWorkerHeartbeat,
  getTeamsWorkerStatus,
} from "./teams-worker";
import {
  readWorkerDesiredState,
  setWorkerDesiredRunning,
} from "./worker-desired-state";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const owner = { orgId: "org_teams", profileId: "teams_agent" };

test("a Teams listener needs live heartbeat and recorded port to report readiness", async () => {
  await withTempHome("teams-worker-", async () => {
    expect(await getTeamsWorkerStatus(owner)).toMatchObject({
      configured: false,
      connected: false,
      running: false,
    });
    globalThis.fetch = asTestFetch(async () =>
      Response.json({ access_token: "fixture-token", token_type: "Bearer" })
    );
    await saveTeamsConfig(
      {
        allowedUserIds: "33333333-3333-4333-8333-333333333333",
        clientId: "22222222-2222-4222-8222-222222222222",
        clientSecret: "fixture-secret",
        tenantId: "11111111-1111-4111-8111-111111111111",
      },
      owner
    );
    const heartbeat = createTeamsWorkerHeartbeat(owner);
    expect((await getTeamsWorkerStatus(owner)).running).toBe(false);
    // A fresh heartbeat with a live pid but no lock: the pid was reused.
    await heartbeat.write(true);
    expect((await getTeamsWorkerStatus(owner)).running).toBe(false);
    await heartbeat.acquire();
    await heartbeat.write(true);
    expect((await getTeamsWorkerStatus(owner)).connected).toBe(false);
    await saveTeamsInboundPort(43_120, owner);
    expect(await getTeamsWorkerStatus(owner)).toMatchObject({
      configured: true,
      connected: true,
      paired: true,
      running: true,
    });
    await heartbeat.clear();
    expect(await getTeamsWorkerStatus(owner)).toMatchObject({
      configured: true,
      connected: false,
      running: false,
    });
  });
});

test("Teams start intent belongs to its organization and agent", async () => {
  await withTempHome("teams-worker-", async () => {
    expect((await readWorkerDesiredState(owner)).teams).toBe(false);
    await setWorkerDesiredRunning("teams", true, owner);
    expect((await readWorkerDesiredState(owner)).teams).toBe(true);
    expect(
      (await readWorkerDesiredState({ ...owner, profileId: "another" })).teams
    ).toBe(false);
    await setWorkerDesiredRunning("teams", false, owner);
    expect((await readWorkerDesiredState(owner)).teams).toBe(false);
  });
});
