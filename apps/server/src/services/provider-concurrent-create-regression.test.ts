import { expect, test } from "bun:test";
import {
  type CreateProviderRequest,
  loadUserConfig,
  type ThinkingSettings,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { loginPlatformAdminSession } from "../http/test-session-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { providerPublicationLock } from "./provider-instance-helpers";

setupTestConfigDir("nakama-provider-create-race-");

function deferred() {
  let resolve!: () => void;

  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function setup() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);

  if (process.env.NAKAMA_PROVIDER_LOCK_PROBE === "1") {
    const originalCreate = agent.createProvider.bind(agent);
    Object.assign(agent, {
      createProvider: (input: CreateProviderRequest) =>
        providerPublicationLock.withLock("providers", () =>
          originalCreate(input)
        ),
    });
  }

  const { app, authService } = createMinimalHonoApp({ agent, databaseAdapter });

  const session = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const now = new Date().toISOString();
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: "org_probe",
    name: "Probe",
    slug: "probe",
    updatedAt: now,
  });
  const actor = await databaseAdapter.getUserByEmail("platform@example.com");
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId: "org_probe",
    role: "admin",
    userId: actor!.id,
  });

  const headers = session.headers({
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
    "X-Org-Id": "org_probe",
  });

  const save = (label: string) =>
    app.fetch(
      new Request("http://localhost:4310/v1/providers", {
        body: JSON.stringify({
          customModels: [{ default: true, id: "llama-3.3-70b-versatile" }],
          label,
          type: "groq",
        }),
        headers,
        method: "POST",
      })
    );

  const initial = await save("Initial provider");
  expect(initial.status).toBe(200);
  const initialId = (await initial.json()).provider.id;

  return { agent, databaseAdapter, initialId, save };
}

test("sequential provider creation retains all acknowledged providers", async () => {
  const { agent, save, initialId } = await setup();
  const a = await save("Sequential A");
  const b = await save("Sequential B");
  expect([a.status, b.status]).toEqual([200, 200]);

  const ids = [
    initialId,
    (await a.json()).provider.id,
    (await b.json()).provider.id,
  ];

  const persisted = await loadUserConfig();
  expect(persisted!.providers.map((p) => p.id).sort()).toEqual(ids.sort());
  expect((await agent.listProviders()).providers).toHaveLength(3);
});

test("concurrent provider creation retains all acknowledged providers", async () => {
  const { agent, databaseAdapter, save, initialId } = await setup();
  const firstRead = deferred();
  const releaseFirstRead = deferred();
  const secondDispatched = deferred();

  // SAFETY: resolveThinkingSettings is private on AgentService; its public
  // contract (no args, returns ThinkingSettings) is stable and tested below.
  const realResolveThinkingSettings = (
    agent as {
      resolveThinkingSettings(): Promise<ThinkingSettings>;
    }
  ).resolveThinkingSettings.bind(agent);

  const realCreate = agent.createProvider.bind(agent);
  let reads = 0;
  Object.assign(agent, {
    createProvider: (input: CreateProviderRequest) => {
      if (input.label === "Concurrent B") {
        secondDispatched.resolve();
      }

      return realCreate(input);
    },
    resolveThinkingSettings: async () => {
      const settings = await realResolveThinkingSettings();
      reads += 1;

      if (reads === 1) {
        firstRead.resolve();
        await releaseFirstRead.promise;
      }

      return settings;
    },
  });

  try {
    const a = save("Concurrent A");
    await firstRead.promise;
    const b = save("Concurrent B");
    await secondDispatched.promise;
    releaseFirstRead.resolve();
    const responses = await Promise.all([a, b]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);

    const ids = [
      initialId,
      ...(await Promise.all(
        responses.map(async (r) => (await r.json()).provider.id)
      )),
    ];

    const persisted = await loadUserConfig();
    expect(persisted!.providers.map((p) => p.id).sort()).toEqual(ids.sort());
    const reloaded = new AgentService(persisted, null, databaseAdapter);
    expect(
      (await reloaded.listProviders()).providers.map((p) => p.id).sort()
    ).toEqual(ids.sort());
  } finally {
    releaseFirstRead.resolve();
  }
});
