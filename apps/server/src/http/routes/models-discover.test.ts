import { expect, test } from "bun:test";
import {
  type CreateProviderRequest,
  type CreateProviderResponse,
  type CustomModelEntry,
  type DiscoverModelsRequest,
  loadUserConfig,
  type ModelsResponse,
  type ProviderName,
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

async function createCustomModelProvider(
  type: ProviderName,
  entry: CustomModelEntry
) {
  const databaseAdapter = createInMemoryDatabaseAdapter();

  const { app, authService } = createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    databaseAdapter,
  });

  const session = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const orgId = "org_model_limits";
  const now = new Date().toISOString();
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: orgId,
    name: "Model limits",
    slug: "model-limits",
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
    path: string,
    method: string,
    body?: CreateProviderRequest | UpdateProviderRequest
  ) =>
    app.fetch(
      new Request(`http://localhost:4310/v1/${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "X-Org-Id": orgId,
        }),
        method,
      })
    );

  const response = await request("providers", "POST", {
    baseUrl: "http://127.0.0.1:9999/v1",
    customModels: [entry],
    label: "Saved model limits",
    type,
  });

  expect(response.status).toBe(200);
  const { provider }: CreateProviderResponse = await response.json();

  return {
    async readModel() {
      const response = await request("models", "GET");
      expect(response.status).toBe(200);
      const { models }: ModelsResponse = await response.json();

      return models.find(
        (model) => model.providerId === provider.id && model.id === entry.id
      );
    },
    async readSavedModel() {
      const config = await loadUserConfig();

      return config?.providers.find((saved) => saved.id === provider.id)
        ?.customModels?.[0];
    },
    async updateModel(model: CustomModelEntry) {
      const response = await request(`providers/${provider.id}`, "PATCH", {
        customModels: [model],
      });

      expect(response.status).toBe(200);
    },
    providerId: provider.id,
  };
}

for (const type of [
  "openai_compatible",
  "ollama",
  "groq",
  "openrouter",
  "cerebras",
] as const) {
  test(`${type}: model catalog preserves saved sizes and other metadata`, async () => {
    const entry = {
      contextWindow: 64_000,
      default: true,
      id: "vendor/model-a",
      inputPerMillionUsd: 0,
      maxOutputTokens: 2048,
      name: "Saved model",
      outputPerMillionUsd: 0,
      supportsThinking: false,
      supportsVision: true,
    };

    const provider = await createCustomModelProvider(type, entry);

    expect(await provider.readSavedModel()).toMatchObject(entry);
    expect(await provider.readModel()).toMatchObject({
      ...entry,
      provider: type,
      providerId: provider.providerId,
      providerLabel: "Saved model limits",
    });
  });

  test(`${type}: model catalog reflects sizes saved by PATCH`, async () => {
    const entry = { default: true, id: "vendor/model-a" };
    const provider = await createCustomModelProvider(type, entry);

    const updated = {
      ...entry,
      contextWindow: 32_000,
      maxOutputTokens: 4096,
    };

    await provider.updateModel(updated);

    expect(await provider.readSavedModel()).toMatchObject(updated);
    expect(await provider.readModel()).toMatchObject(updated);
  });

  for (const limits of [
    {},
    { contextWindow: 24_000 },
    { maxOutputTokens: 1024 },
  ]) {
    test(`${type}: model catalog applies fallbacks only to omitted sizes ${JSON.stringify(limits)}`, async () => {
      const provider = await createCustomModelProvider(type, {
        id: "vendor/model-a",
        ...limits,
      });

      expect(await provider.readModel()).toMatchObject({
        contextWindow: 128_000,
        id: "vendor/model-a",
        maxOutputTokens: 8192,
        ...limits,
      });
    });
  }
}
