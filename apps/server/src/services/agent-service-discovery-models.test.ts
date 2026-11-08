import { describe, expect, test } from "bun:test";
import { loadUserConfig } from "@nakama/core";
import type {
  CreateProviderRequest,
  CreateProviderResponse,
  CustomModelEntry,
  ListProvidersResponse,
  ModelsResponse,
  ProviderName,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";

describe("saving models for discovery providers", () => {
  setupTestConfigDir("nakama-discovery-models-");

  const picked = [{ default: true, id: "z-ai/glm-5.3-flash" }];

  async function setup() {
    const databaseAdapter = createInMemoryDatabaseAdapter();

    const { app } = createMinimalHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      databaseAdapter,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const send = (
      method: string,
      url: string,
      body?: CreateProviderRequest | UpdateProviderRequest
    ) =>
      app.fetch(
        new Request(`http://localhost:4310${url}`, {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

    const create = async (body: CreateProviderRequest) => {
      const response = await send("POST", "/v1/providers", body);

      expect(response.status).toBe(200);

      // SAFETY: A 200 from this route carries a CreateProviderResponse.
      return (await response.json()) as CreateProviderResponse;
    };

    const listed = async (id: string) => {
      const response = await send("GET", "/v1/providers");

      // SAFETY: A 200 from this route carries a ListProvidersResponse.
      const body = (await response.json()) as ListProvidersResponse;

      return body.providers.find((provider) => provider.id === id);
    };

    const modelIds = async () => {
      const response = await send("GET", "/v1/models");

      // SAFETY: A 200 from this route carries a ModelsResponse.
      const body = (await response.json()) as ModelsResponse;

      return body.models.map((model) => model.id);
    };

    const savedModels = async (id: string) =>
      (await loadUserConfig())?.providers.find((provider) => provider.id === id)
        ?.customModels;

    return { create, listed, modelIds, savedModels, send };
  }

  test.each<ProviderName>(["command_code", "groq"])(
    "keeps the models picked on update for %s",
    async (type) => {
      const { create, listed, modelIds, savedModels, send } = await setup();
      const { provider } = await create({ type });

      const response = await send("PATCH", `/v1/providers/${provider.id}`, {
        customModels: picked,
      });

      expect(response.status).toBe(200);
      expect(await listed(provider.id)).toMatchObject({
        customModels: picked,
        modelCount: 1,
      });
      expect(await modelIds()).toEqual([picked[0].id]);
      expect(await savedModels(provider.id)).toEqual(picked);
    }
  );

  test("keeps the saved models when a PATCH sends no customModels", async () => {
    const { create, listed, send } = await setup();

    const { provider } = await create({
      customModels: picked,
      type: "command_code",
    });

    const response = await send("PATCH", `/v1/providers/${provider.id}`, {
      label: "Renamed",
    });

    expect(response.status).toBe(200);
    expect(await listed(provider.id)).toMatchObject({
      customModels: picked,
      modelCount: 1,
    });
  });

  test("lists no models for a discovery provider saved without any", async () => {
    const { create, listed } = await setup();
    const { provider } = await create({ type: "command_code" });

    expect(await listed(provider.id)).toMatchObject({ modelCount: 0 });
  });

  test.each<ProviderName>(["command_code", "groq"])(
    "keeps the models picked on create for %s",
    async (type) => {
      const { create, listed, savedModels } = await setup();
      const created = await create({ customModels: picked, type });

      expect(created.initialModel).toBe(picked[0].id);
      expect(await listed(created.provider.id)).toMatchObject({
        modelCount: 1,
      });
      expect(await savedModels(created.provider.id)).toEqual(picked);
    }
  );

  test.each<[string, CustomModelEntry[]]>([
    ["an empty list", []],
    ["a blank model id", [{ id: "  " }]],
  ])("rejects %s and keeps the saved models", async (_, customModels) => {
    const { create, listed, send } = await setup();

    const { provider } = await create({
      customModels: picked,
      type: "command_code",
    });

    const response = await send("PATCH", `/v1/providers/${provider.id}`, {
      customModels,
    });

    expect(response.status).toBe(400);
    expect(await listed(provider.id)).toMatchObject({
      customModels: picked,
      modelCount: 1,
    });
  });

  test("an OpenAI-compatible provider still needs one model", async () => {
    const { create, listed, send } = await setup();

    const { provider } = await create({
      baseUrl: "https://example.com/v1",
      customModels: picked,
      label: "Example",
      type: "openai_compatible",
    });

    const response = await send("PATCH", `/v1/providers/${provider.id}`, {
      customModels: [],
    });

    expect(response.status).toBe(400);
    expect(await listed(provider.id)).toMatchObject({ modelCount: 1 });
  });
});
