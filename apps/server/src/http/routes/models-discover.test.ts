import { expect, test } from "bun:test";
import {
  type CreateProviderRequest,
  type CreateProviderResponse,
  type CustomModelEntry,
  type DiscoverModelsRequest,
  loadUserConfig,
  type UpdateProviderRequest,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-models-discover-test-");

async function createFireworksFixture() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);
  const { app, authService } = createMinimalHonoApp({ agent, databaseAdapter });

  const session = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const now = new Date().toISOString();
  const orgId = "org_fireworks";
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: orgId,
    name: "Fireworks",
    slug: "fireworks",
    updatedAt: now,
  });
  const user = await databaseAdapter.getUserByEmail("platform@example.com");
  await databaseAdapter.upsertOrgMember({
    createdAt: now,
    orgId,
    role: "admin",
    userId: user!.id,
  });

  const request = (
    suffix: string,
    method: string,
    body: CreateProviderRequest | UpdateProviderRequest
  ) =>
    app.fetch(
      new Request(`http://localhost:4310/v1/providers${suffix}`, {
        body: JSON.stringify(body),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "X-Org-Id": orgId,
        }),
        method,
      })
    );

  const create = async (customModels: CustomModelEntry[]) => {
    const response = await request("", "POST", {
      customModels,
      label: "Fireworks",
      type: "fireworks",
    });

    expect(response.status).toBe(200);

    // SAFETY: The real create route returned HTTP 200 with its provider response.
    return (await response.json()) as CreateProviderResponse;
  };

  return { agent, create, databaseAdapter, request };
}

const FIREWORKS_KIMI = "accounts/fireworks/models/kimi-k2p6";

const FIREWORKS_GLM = "accounts/fireworks/models/glm-5p2";

for (const selectedFirst of [false, true]) {
  test(`Fireworks creation honors the saved default with selectedFirst=${selectedFirst}`, async () => {
    const { agent, create } = await createFireworksFixture();
    const selected = { default: true, id: FIREWORKS_GLM };
    const other = { id: FIREWORKS_KIMI };

    const created = await create(
      selectedFirst ? [selected, other] : [other, selected]
    );

    const stored = await loadUserConfig();

    const instance = stored!.providers.find(
      (provider) => provider.id === created.provider.id
    )!;

    expect(
      instance.customModels
        ?.filter((model) => model.default)
        .map((model) => model.id)
    ).toEqual([FIREWORKS_GLM]);
    expect(created.initialModel).toBe(FIREWORKS_GLM);
    expect(agent.getUsageStatusFields().currentModel).toBe(FIREWORKS_GLM);
    const catalog = await agent.getModels();
    expect(
      catalog.models
        .filter((model) => model.providerId === instance.id && model.default)
        .map((model) => model.id)
    ).toEqual([FIREWORKS_GLM]);
  });
}

test("Fireworks default changes survive provider update and config reload", async () => {
  const { agent, create, databaseAdapter, request } =
    await createFireworksFixture();

  const created = await create([
    { default: true, id: FIREWORKS_KIMI },
    { id: FIREWORKS_GLM },
  ]);

  expect(created.initialModel).toBe(FIREWORKS_KIMI);

  const updated = await request(`/${created.provider.id}`, "PATCH", {
    customModels: [
      { id: FIREWORKS_KIMI },
      { default: true, id: FIREWORKS_GLM },
    ],
  });

  expect(updated.status).toBe(200);
  const stored = await loadUserConfig();

  const instance = stored!.providers.find(
    (provider) => provider.id === created.provider.id
  )!;

  expect(
    instance.customModels
      ?.filter((model) => model.default)
      .map((model) => model.id)
  ).toEqual([FIREWORKS_GLM]);
  expect(agent.getUsageStatusFields().currentModel).toBe(FIREWORKS_GLM);
  const reloaded = new AgentService(stored, null, databaseAdapter);
  expect(reloaded.getUsageStatusFields().currentModel).toBe(FIREWORKS_GLM);
  const catalog = await reloaded.getModels();
  expect(
    catalog.models
      .filter((model) => model.providerId === instance.id && model.default)
      .map((model) => model.id)
  ).toEqual([FIREWORKS_GLM]);
});

test.each(["", "/ollama"])(
  "discovers native Ollama models behind prefix %s",
  async (prefix) => {
    const paths: string[] = [];

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        paths.push(path);

        return path === `${prefix}/api/tags`
          ? Response.json({ models: [{ name: "local-model" }] })
          : new Response("Not found", { status: 404 });
      },
    });

    try {
      const databaseAdapter = createInMemoryDatabaseAdapter();
      const agent = new AgentService(null, null, databaseAdapter);

      const { app } = createMinimalHonoApp({
        agent,
        databaseAdapter,
      });

      const session = await setupFreshInstallSession(app, databaseAdapter);

      const response = await app.fetch(
        new Request("http://localhost:4310/v1/models/discover", {
          body: JSON.stringify({
            baseUrl: `${server.url.origin}${prefix}/v1`,
            hostMode: "local",
            provider: "ollama",
          }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        })
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        customModels: [{ id: "local-model", name: "local-model" }],
      });
      expect(paths).toContain(`${prefix}/api/tags`);
    } finally {
      server.stop(true);
    }
  }
);

test("discover hands provider and hostMode to the service", async () => {
  const received: DiscoverModelsRequest[] = [];
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const { app } = createMinimalHonoApp({
    agent: {
      discoverModels: async (request: DiscoverModelsRequest) => {
        received.push(request);

        // SAFETY: The route only serializes what the service returns.
        return {} as never;
      },
    },
    databaseAdapter,
  });

  const session = await setupFreshInstallSession(
    app,
    databaseAdapter,
    "admin@example.com"
  );

  const response = await app.fetch(
    new Request("http://localhost:4310/v1/models/discover", {
      body: JSON.stringify({
        apiKey: "key",
        baseUrl: "https://ollama.com",
        hostMode: "cloud",
        provider: "ollama",
      }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  // Both keys are what pick the provider-specific fetch path.
  expect(received).toEqual([
    {
      apiKey: "key",
      baseUrl: "https://ollama.com",
      hostMode: "cloud",
      provider: "ollama",
    },
  ]);
});

test("model catalogs answer 410 for the removed models.dev id and 400 for built-ins", async () => {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({ databaseAdapter });

  await seedOrgAdmin(databaseAdapter, { authService });

  const session = await loginUserSession(
    app,
    "admin@example.com",
    "password123",
    "org_test"
  );

  const statusFor = async (catalogId: string) =>
    (
      await app.fetch(
        new Request(`http://localhost:4310/v1/model-catalogs/${catalogId}`, {
          headers: session.headers(),
        })
      )
    ).status;

  expect(await statusFor("models-dev")).toBe(410);
  expect(await statusFor("constructor")).toBe(400);
  expect(await statusFor("toString")).toBe(400);
});

test("an org admin cannot discover from a caller-chosen base URL", async () => {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const { app, authService } = createMinimalHonoApp({
    agent: {
      discoverModels: async () => {
        throw new Error("must not reach the service");
      },
    },
    databaseAdapter,
  });

  await seedOrgAdmin(databaseAdapter, { authService });

  const session = await loginUserSession(
    app,
    "admin@example.com",
    "password123",
    "org_test"
  );

  const response = await app.fetch(
    new Request("http://localhost:4310/v1/models/discover", {
      body: JSON.stringify({
        baseUrl: "http://127.0.0.1:11434",
        provider: "ollama",
      }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );

  expect(response.status).toBe(403);
});
