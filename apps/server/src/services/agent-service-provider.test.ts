import { describe, expect, spyOn, test } from "bun:test";
import type {
  ChatCompletionResult,
  ProviderClient,
  ProviderInstance,
} from "@nakama/core";
import { NETRA_AGENT_MODEL_ID } from "@nakama/core/discovery-providers";
import {
  createInMemoryDatabaseAdapter,
  mergeWorkspaceSettings,
} from "@nakama/db";
import { asTestFetch } from "../providers/test-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { LlmUsageTracker } from "./llm-usage-tracker";

const ORG_ID = "org_test";

interface AgentServiceHarnessAccess {
  createHarness(options: {
    orgId: string;
    provider: ProviderClient;
    providerInstance: ProviderInstance;
    modelId: string;
    thinking: { enabled: boolean; effort: "medium" };
  }): { provider: ProviderClient };
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

test("rejects a Netra provider when the model endpoint rejects its API key", async () => {
  using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    asTestFetch(async () => new Response("invalid key", { status: 401 }))
  );

  const service = new AgentService(null, null, createInMemoryDatabaseAdapter());

  await expect(
    service.createProvider({
      apiKey: "invalid-key",
      model: NETRA_AGENT_MODEL_ID,
      type: "netra",
    })
  ).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).toHaveBeenCalled();
});

test("discovers the supported Netra model without a custom base URL", async () => {
  using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    asTestFetch(async () =>
      Response.json({ data: [{ id: NETRA_AGENT_MODEL_ID }] })
    )
  );

  const service = new AgentService(null, null, createInMemoryDatabaseAdapter());

  const result = await service.discoverModels({
    apiKey: "test-key",
    provider: "netra",
  });

  expect(result.provider).toBe("netra");
  expect(result.models.map((model) => model.id)).toEqual([
    NETRA_AGENT_MODEL_ID,
  ]);
  expect(fetchMock).toHaveBeenCalled();
});

describe("AgentService usage pricing context", () => {
  setupTestConfigDir("nakama-usage-context-");

  test("retains each harness's rates when another provider completes during a stream", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    const service = new AgentService(null, null, db, tracker);

    // SAFETY: The test builds the harness with the options shown below.
    const createHarness =
      privateServiceAccess<AgentServiceHarnessAccess>(
        service
      ).createHarness.bind(service);

    const result: ChatCompletionResult = {
      assistantMessage: { content: "ok", role: "assistant" },
      content: "ok",
      toolCalls: [],
      usage: {
        inputTokens: 100_000,
        outputTokens: 20_000,
        totalTokens: 120_000,
      },
    };

    const stream = Promise.withResolvers<ChatCompletionResult>();

    const provider: ProviderClient = {
      generateChat: () => Promise.resolve(result),
      generateText: () => Promise.resolve({ content: "unused" }),
      name: "openai",
      streamChat: () => stream.promise,
    };

    const options = {
      modelId: "gpt-5.5",
      orgId: ORG_ID,
      provider,
      providerInstance: {
        apiKey: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "api",
        label: "API",
        type: "openai" as const,
      },
      thinking: { effort: "medium" as const, enabled: false },
    };

    const api = createHarness.call(service, options).provider;

    const input = {
      messages: [{ content: "hi", role: "user" as const }],
      system: "s",
    };

    const pending = api.streamChat(input, { onChunk: () => undefined });

    const subscription = createHarness.call(service, {
      ...options,
      providerInstance: {
        ...options.providerInstance,
        id: "subscription",
        type: "chatgpt",
      },
    }).provider;

    expect((await subscription.generateChat(input)).usage?.costUsd).toBe(0);
    stream.resolve(result);
    expect((await pending).usage?.costUsd).toBeCloseTo(1.1);
    // Cached harnesses keep their own rates after another harness is built.
    expect((await api.generateChat(input)).usage?.costUsd).toBeCloseTo(1.1);
    expect((await tracker.getStats(ORG_ID)).estimatedCostUsd).toBeCloseTo(2.2);
    expect((await tracker.getStats(ORG_ID)).requestCount).toBe(3);
  });

  test("prices OpenAI image parsing independently of a DeepSeek primary", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      model: "primary::deepseek-v4-flash",
    };

    await db.upsertProfile(profile);
    const tracker = new LlmUsageTracker(db);

    const service = new AgentService(
      {
        defaultProviderId: "primary",
        providers: [
          {
            apiKey: "test",
            createdAt: profile.createdAt,
            id: "primary",
            label: "Primary",
            type: "deepseek",
          },
          {
            apiKey: "test",
            createdAt: profile.createdAt,
            id: "vision",
            label: "Vision",
            type: "openai",
          },
        ],
        visionModel: "vision::gpt-4o-mini",
      },
      null,
      db,
      tracker
    );

    using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async (...args: Parameters<typeof fetch>) => {
        const init = args[1];
        const body = JSON.parse(String(init?.body));

        if (body.model === "gpt-4o-mini") {
          return Response.json({
            choices: [{ message: { content: "A small image." } }],
            usage: { completion_tokens: 20_000, prompt_tokens: 100_000 },
          });
        }

        expect(body.model).toBe("deepseek-v4-flash");

        return Response.json({
          choices: [{ message: { content: "ok" } }],
          usage: { completion_tokens: 20_000, prompt_tokens: 100_000 },
        });
      })
    );

    const id = await service.createSession(ORG_ID, "web", profile.id);
    const session = await service.resolveSession(id, ORG_ID);
    await session!.send({
      images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
      message: "Describe the image",
    });
    const byModel = await tracker.getStatsByModel(ORG_ID);
    expect(
      byModel.find((row) => row.modelId === "gpt-4o-mini")?.estimatedCostUsd
    ).toBeCloseTo(0.027, 6);
    expect(
      byModel.find((row) => row.modelId === "deepseek-v4-flash")
        ?.estimatedCostUsd
    ).toBeCloseTo(0.054, 6);
    expect((await tracker.getStats(ORG_ID)).estimatedCostUsd).toBeCloseTo(
      0.081,
      6
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("AgentService vision settings", () => {
  setupTestConfigDir("nakama-vision-settings-");

  test.each(["primary", "vision"] as const)(
    "handles missing %s credentials without a provider call",
    async (missing) => {
      const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
      const originalOpenaiKey = process.env.OPENAI_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.OPENAI_API_KEY;

      using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
        asTestFetch(async () => {
          throw new Error("Unexpected provider call");
        })
      );

      try {
        const db = createInMemoryDatabaseAdapter();

        const profile = {
          ...createDefaultProfile(),
          model: "primary::deepseek-v4-flash",
        };

        await db.upsertProfile(profile);
        const tracker = new LlmUsageTracker(db);

        const service = new AgentService(
          {
            defaultProviderId: "primary",
            providers: [
              {
                apiKey: missing === "primary" ? "" : "test",
                createdAt: profile.createdAt,
                id: "primary",
                label: "Primary",
                type: "deepseek",
              },
              {
                apiKey: "",
                createdAt: profile.createdAt,
                id: "vision",
                label: "Vision",
                type: "openai",
              },
            ],
            visionModel: "vision::gpt-4o-mini",
          },
          null,
          db,
          tracker
        );

        const id = await service.createSession(ORG_ID, "web", profile.id);
        const session = await service.resolveSession(id, ORG_ID);
        expect(session).not.toBeNull();

        if (missing === "primary") {
          await session!.send("Hello");
          expect(session!.getHistory().map((message) => message.role)).toEqual([
            "user",
            "assistant",
          ]);
        } else {
          await expect(
            session!.send({
              images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
              message: "Describe",
            })
          ).rejects.toMatchObject({ status: 400 });
          expect(session!.getHistory()).toEqual([]);
        }

        expect(fetchMock).not.toHaveBeenCalled();
        expect((await tracker.getStats(ORG_ID)).requestCount).toBe(0);
      } finally {
        if (originalDeepseekKey === undefined) {
          delete process.env.DEEPSEEK_API_KEY;
        } else {
          process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
        }

        if (originalOpenaiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalOpenaiKey;
        }
      }
    }
  );

  test("persists vision model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();

    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    const saved = await service.setVisionSettings({
      model: "p-openai-1::gpt-4o-mini",
    });

    expect(saved).toEqual({ vision: { model: "p-openai-1::gpt-4o-mini" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: null,
      visionModel: "p-openai-1::gpt-4o-mini",
    });
    expect(await service.getVisionSettings()).toEqual({
      vision: { model: "p-openai-1::gpt-4o-mini" },
    });
  });
});

describe("AgentService transcription settings", () => {
  test("persists transcription model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();

    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    const saved = await service.setTranscriptionSettings({
      model: "p-openai-1::whisper-1",
    });

    expect(saved).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: "p-openai-1::whisper-1",
    });
    expect(await service.getTranscriptionSettings()).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
  });

  test.each([
    {
      field: "visionModel",
      model: "p-openai-1::gpt-4o-mini",
      save: (service: AgentService) =>
        service.setVisionSettings({ model: "p-openai-1::gpt-4o-mini" }),
    },
    {
      field: "transcriptionModel",
      model: "p-openai-1::whisper-1",
      save: (service: AgentService) =>
        service.setTranscriptionSettings({ model: "p-openai-1::whisper-1" }),
    },
  ] as const)(
    "does not reset coding-agent passthrough when $field is saved",
    async ({ field, model, save }) => {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertWorkspaceSettings(
        mergeWorkspaceSettings(null, {
          codingAgentHarnesses: [],
          codingAgentProviderPassthrough: false,
          id: "workspace-settings",
          imageModel: null,
          selectedCodingAgentHarness: null,
          transcriptionModel: null,
          updatedAt: new Date().toISOString(),
          visionModel: null,
        })
      );

      const service = new AgentService(
        {
          defaultProviderId: "p-openai-1",
          providers: [
            {
              apiKey: "test-key",
              createdAt: new Date().toISOString(),
              id: "p-openai-1",
              label: "OpenAI",
              type: "openai",
            },
          ],
        },
        null,
        db
      );

      await save(service);

      expect(await db.getWorkspaceSettings()).toMatchObject({
        codingAgentProviderPassthrough: false,
        [field]: model,
      });
    }
  );
});
