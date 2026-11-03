import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
  NakamaApiError,
  type ProviderClient,
  type UserConfig,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import {
  ComputerAuthService,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";
import { LlmUsageTracker } from "../../services/llm-usage-tracker";
import { OrgService } from "../../services/org-service";
import { testDeviceKey } from "../../testing/computer-device";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedOrgAdmin } from "../test-session-helpers";

const vendorRequests: unknown[] = [];

/** The vendor answers with text, then one tool call, then usage. */
const vendor = setupServer(
  http.post(
    "https://api.openai.com/v1/chat/completions",
    async ({ request }) => {
      vendorRequests.push(await request.json());

      const chunks = [
        { choices: [{ delta: { content: "Listing." }, index: 0 }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: { arguments: '{"command":"ls"}', name: "bash" },
                    id: "call_1",
                    index: 0,
                    type: "function",
                  },
                ],
              },
              index: 0,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }] },
        {
          choices: [],
          usage: { completion_tokens: 7, prompt_tokens: 40, total_tokens: 47 },
        },
      ];

      const body = `${chunks
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("")}data: [DONE]\n\n`;

      return new HttpResponse(body, {
        headers: { "content-type": "text/event-stream" },
      });
    }
  )
);

beforeAll(() => vendor.listen({ onUnhandledRequest: "error" }));

afterEach(() => vendor.resetHandlers());

afterAll(() => vendor.close());

const eventSchema = z.object({ data: z.unknown(), type: z.string() });

const resultSchema = z.object({
  content: z.string(),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string() })),
});

async function setup() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const usageTracker = new LlmUsageTracker(databaseAdapter);

  const config: UserConfig = {
    defaultProviderId: "openai-main",
    providers: [
      {
        apiKey: "sk-test-not-real",
        createdAt: new Date().toISOString(),
        id: "openai-main",
        label: "OpenAI",
        type: "openai",
      },
    ],
  };

  const agent = new AgentService(config, null, databaseAdapter, usageTracker);
  const computerAuth = new ComputerAuthService(databaseAdapter);

  const { app } = createMinimalHonoApp({
    agent,
    computerAuth,
    databaseAdapter,
  });

  const { orgId, userId } = await seedOrgAdmin(databaseAdapter, {
    role: "member",
  });

  const key = testDeviceKey();

  const enrolled = await computerAuth.enroll({
    installId: "install_1",
    name: "Ada's MacBook",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

  if (!enrolled) {
    throw new Error("enroll refused");
  }

  const { computer, confirmCode } = enrolled;

  const tokenResponse = await app.request(LLM_TOKEN_PATH, {
    body: JSON.stringify(key.signRequest(computer.id, { confirmCode })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  const { pass } = z
    .object({ pass: z.string() })
    .parse(await tokenResponse.json());

  return { agent, app, databaseAdapter, orgId, pass, usageTracker, userId };
}

function post(
  app: Awaited<ReturnType<typeof setup>>["app"],
  path: string,
  pass: string | null,
  body: string
) {
  const headers = new Headers({ "content-type": "application/json" });

  if (pass) {
    headers.set("authorization", `Bearer ${pass}`);
  }

  return app.request(path, { body, headers, method: "POST" });
}

const chatBody = {
  messages: [{ content: "What is here?", role: "user" }],
  model: "gpt-4o-mini",
  system: "You are helpful.",
  tools: [
    {
      description: "Run a shell command",
      name: "bash",
      parameters: {
        properties: { command: { type: "string" } },
        type: "object",
      },
    },
  ],
};

test("a computer with a pass streams one model turn, and usage is billed to its member", async () => {
  const { app, databaseAdapter, orgId, pass, usageTracker, userId } =
    await setup();

  const response = await post(
    app,
    "/v1/llm/chat",
    pass,
    JSON.stringify(chatBody)
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");

  const events = (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => eventSchema.parse(JSON.parse(frame.slice(6))));

  const types = events.map((event) => event.type);

  expect(types).toContain("chunk");
  expect(types.at(-1)).toBe("result");

  const result = resultSchema.parse(events.at(-1)?.data);

  expect(result.content).toBe("Listing.");
  expect(result.toolCalls).toMatchObject([{ id: "call_1", name: "bash" }]);
  expect(vendorRequests).toHaveLength(1);

  await usageTracker.getStats(orgId);

  const actors = await databaseAdapter.listLlmUsageStatsByActor(orgId);

  expect(actors.find((actor) => actor.userId === userId)).toMatchObject({
    requestCount: 1,
  });

  // The call counts against the org's monthly turn and token limits.
  await Bun.sleep(0);

  expect(await databaseAdapter.listLlmTurnUsage(orgId)).toMatchObject([
    { inputTokens: 40, outputTokens: 7, turns: 1 },
  ]);
});

test("model routes refuse a missing pass, a bad pass and a cloud attachment reference", async () => {
  const { app, pass } = await setup();

  expect(
    (await post(app, "/v1/llm/chat", null, JSON.stringify(chatBody))).status
  ).toBe(401);
  expect(
    (await post(app, "/v1/llm/chat", "nope.nope", JSON.stringify(chatBody)))
      .status
  ).toBe(401);
  expect((await app.request("/v1/llm/models")).status).toBe(401);

  const withRef = {
    ...chatBody,
    messages: [
      {
        content: [
          {
            attachmentId: "attachment_of_someone_else",
            mediaType: "image/png",
            size: 10,
            type: "image_ref",
          },
        ],
        role: "user",
      },
    ],
  };

  expect(
    (await post(app, "/v1/llm/chat", pass, JSON.stringify(withRef))).status
  ).toBe(400);
});

test("a pass lists the models", async () => {
  const { app, pass } = await setup();

  const response = await app.request("/v1/llm/models", {
    headers: { authorization: `Bearer ${pass}` },
  });

  const body = z
    .object({ models: z.array(z.object({ id: z.string() })) })
    .parse(await response.json());

  expect(response.status).toBe(200);
  expect(body.models.length).toBeGreaterThan(0);
});

test("when an admin turns Nakama Desktop off, model calls are refused, and they work again when it is on", async () => {
  const { app, databaseAdapter, orgId, pass } = await setup();
  const orgService = new OrgService(databaseAdapter, new AuthService());

  const models = () =>
    app.request("/v1/llm/models", {
      headers: { authorization: `Bearer ${pass}` },
    });

  expect((await models()).status).toBe(200);

  await orgService.updateOrganization(orgId, { desktopModelsEnabled: false });
  expect(
    (await databaseAdapter.getOrganizationById(orgId))?.desktopModelsEnabled
  ).toBe(false);
  expect((await models()).status).toBe(403);
  expect(
    (await post(app, "/v1/llm/chat", pass, JSON.stringify(chatBody))).status
  ).toBe(403);

  // Another org setting keeps the switch as it is.
  await orgService.updateOrganization(orgId, { skillsPostTurnReview: true });
  expect((await models()).status).toBe(403);

  await orgService.updateOrganization(orgId, { desktopModelsEnabled: true });
  expect((await models()).status).toBe(200);
});

test("a computer that signs out removes itself, and its pass stops working", async () => {
  const { app, pass } = await setup();
  const headers = { authorization: `Bearer ${pass}` };

  expect(
    (await app.request("/v1/llm/computer", { headers, method: "DELETE" }))
      .status
  ).toBe(204);
  expect((await app.request("/v1/llm/models", { headers })).status).toBe(401);
});

test("a provider request error keeps its status, and never asks the desktop to sign in again", async () => {
  const { app, pass } = await setup();

  // The provider layer turns a vendor key error into a 400 request error.
  vendor.use(
    http.post("https://api.openai.com/v1/chat/completions", () =>
      HttpResponse.json(
        { error: { message: "Incorrect API key.", type: "invalid" } },
        { status: 401 }
      )
    )
  );

  const response = await post(
    app,
    "/v1/llm/text",
    pass,
    JSON.stringify({
      model: "gpt-4o-mini",
      prompt: "Hi",
      system: "You are helpful.",
    })
  );

  expect(response.status).toBe(400);
});

test("a pass whose org is not found is refused", async () => {
  const { app, databaseAdapter, pass } = await setup();
  databaseAdapter.getOrganizationById = () => Promise.resolve(null);

  expect(
    (
      await app.request("/v1/llm/models", {
        headers: { authorization: `Bearer ${pass}` },
      })
    ).status
  ).toBe(401);
});

test("the stream still ends when the quota hold cannot be released", async () => {
  const { app, databaseAdapter, orgId, pass } = await setup();
  const orgService = new OrgService(databaseAdapter, new AuthService());

  await orgService.updateOrganization(orgId, {
    monthlyLlmTokenLimit: 1_000_000,
  });
  databaseAdapter.releaseMonthlyLlmQuota = () =>
    Promise.reject(new Error("database is locked"));

  const response = await post(
    app,
    "/v1/llm/chat",
    pass,
    JSON.stringify(chatBody)
  );

  const types = (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => eventSchema.parse(JSON.parse(frame.slice(6))).type);

  expect(types.at(-1)).toBe("result");
});

test("a model this server does not have is refused, not swapped for the default", async () => {
  const { app, pass } = await setup();
  const vendorCallsBefore = vendorRequests.length;

  for (const model of [
    "openai-main::no-such-model",
    "removed-provider::gpt-4o-mini",
    "no-such-model",
  ]) {
    const response = await post(
      app,
      "/v1/llm/chat",
      pass,
      JSON.stringify({ ...chatBody, model })
    );

    expect(response.status).toBe(404);
  }

  expect(vendorRequests).toHaveLength(vendorCallsBefore);
});

test("a desktop chat with large inline images fits, up to the vendor size", async () => {
  const { app, pass } = await setup();

  const withImage = (bytes: number) =>
    JSON.stringify({
      ...chatBody,
      messages: [
        {
          content: [
            { text: "What is in this photo?", type: "text" },
            {
              data: "A".repeat(bytes),
              mediaType: "image/png",
              type: "image",
            },
          ],
          role: "user",
        },
      ],
    });

  const fits = await post(
    app,
    "/v1/llm/chat",
    pass,
    withImage(15 * 1024 * 1024)
  );

  expect(fits.status).toBe(200);
  await fits.text();

  expect(
    (await post(app, "/v1/llm/chat", pass, withImage(33 * 1024 * 1024))).status
  ).toBe(413);
});

test("a desktop text call counts its tokens, not a turn, like a title on the web", async () => {
  const { app, databaseAdapter, orgId, pass } = await setup();

  vendor.use(
    http.post("https://api.openai.com/v1/chat/completions", () =>
      HttpResponse.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: { content: "Hi", role: "assistant" },
          },
        ],
        usage: { completion_tokens: 3, prompt_tokens: 20, total_tokens: 23 },
      })
    )
  );

  const response = await post(
    app,
    "/v1/llm/text",
    pass,
    JSON.stringify({
      format: "text",
      model: "gpt-4o-mini",
      prompt: "Name this chat.",
      system: "You are helpful.",
    })
  );

  expect(response.status).toBe(200);
  await Bun.sleep(0);

  expect(await databaseAdapter.listLlmTurnUsage(orgId)).toMatchObject([
    { estimatedTurns: 0, inputTokens: 20, outputTokens: 3, turns: 0 },
  ]);
});

test("a desktop can lower or turn off thinking, never raise it above the workspace setting", async () => {
  const { agent, app, pass } = await setup();
  const seen: unknown[] = [];

  const harnessWith = (thinking?: {
    effort?: "low" | "medium" | "high";
    enabled: boolean;
  }) => {
    agent.desktopModelHarness = () =>
      Promise.resolve({
        chatOptions: thinking ? { thinking } : undefined,
        provider: {
          generateChat: () => Promise.reject(new Error("unused")),
          generateText: () => Promise.reject(new Error("unused")),
          name: "openai",
          streamChat: (input) => {
            seen.push(input.providerOptions?.thinking);

            return Promise.resolve({
              assistantMessage: { content: "ok", role: "assistant" },
              content: "ok",
              toolCalls: [],
            });
          },
        },
      });
  };

  const chat = async (thinking?: {
    effort?: "low" | "medium" | "high";
    enabled: boolean;
  }) => {
    const response = await post(
      app,
      "/v1/llm/chat",
      pass,
      JSON.stringify({
        ...chatBody,
        ...(thinking && { providerOptions: { thinking } }),
      })
    );

    await response.text();

    return seen.at(-1);
  };

  harnessWith({ effort: "medium", enabled: true });
  expect(await chat({ effort: "high", enabled: true })).toEqual({
    effort: "medium",
    enabled: true,
  });
  expect(await chat({ effort: "low", enabled: true })).toEqual({
    effort: "low",
    enabled: true,
  });
  expect(await chat({ enabled: false })).toBeUndefined();
  expect(await chat()).toEqual({ effort: "medium", enabled: true });

  // Thinking is off for the workspace: the desktop cannot turn it on.
  harnessWith();
  expect(await chat({ effort: "high", enabled: true })).toBeUndefined();
});

/** Points the desktop harness at a stand-in provider for one test. */
function useStandInProvider(
  agent: Awaited<ReturnType<typeof setup>>["agent"],
  streamChat: ProviderClient["streamChat"]
) {
  agent.desktopModelHarness = () =>
    Promise.resolve({
      provider: {
        generateChat: () => Promise.reject(new Error("unused")),
        generateText: () => Promise.reject(new Error("unused")),
        name: "anthropic",
        streamChat,
      },
    });
}

const okResult = {
  assistantMessage: { content: "ok", role: "assistant" as const },
  content: "ok",
  toolCalls: [],
};

async function events(response: Response) {
  return (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => eventSchema.parse(JSON.parse(frame.slice(6))));
}

test("only provider items the cloud makes are replayed; references to stored items and files are dropped", async () => {
  const { agent, app, pass } = await setup();
  const seen: unknown[] = [];

  useStandInProvider(agent, (input) => {
    seen.push(input.messages);

    return Promise.resolve(okResult);
  });

  const providerContent = [
    { thinking: "Let me think.", signature: "sig", type: "thinking" },
    { id: "rs_1", summary: [], type: "reasoning" },
    { id: "msg_other_member", type: "item_reference" },
    { source: { file_id: "file_org_secret", type: "file" }, type: "document" },
    { file_id: "file_org_secret", text: "hi", type: "text" },
    { fileData: { fileUri: "gs://org-bucket/x" } },
    { text: "Thinking out loud", thought: true, thoughtSignature: "s" },
    { details: "x", type: "reasoning.text" },
  ];

  const response = await post(
    app,
    "/v1/llm/chat",
    pass,
    JSON.stringify({
      ...chatBody,
      messages: [
        { content: "Hi", role: "user" },
        { content: "Hello", providerContent, role: "assistant" },
        { content: "Again", role: "user" },
      ],
    })
  );

  await response.text();

  expect(seen.at(-1)).toMatchObject([
    { role: "user" },
    {
      providerContent: [
        { type: "thinking" },
        { type: "reasoning" },
        { thoughtSignature: "s" },
        { type: "reasoning.text" },
      ],
      role: "assistant",
    },
    { role: "user" },
  ]);
});

test("a provider error reaches the desktop without keys, internal addresses or hosts", async () => {
  const { agent, app, pass } = await setup();

  useStandInProvider(agent, () =>
    Promise.reject(
      new NakamaApiError(
        "OpenAI request failed (401): Incorrect API key provided: sk-proj-abcdef123456. Base URL http://models.internal:8000/v1 at 10.0.4.12:8000",
        400
      )
    )
  );

  const [event] = await events(
    await post(app, "/v1/llm/chat", pass, JSON.stringify(chatBody))
  );

  const error = z
    .object({ message: z.string(), status: z.number() })
    .parse(event?.data);

  expect(error.status).toBe(400);

  for (const internal of [
    "sk-proj-abcdef123456",
    "models.internal",
    "10.0.4.12",
  ]) {
    expect(error.message).not.toContain(internal);
  }

  useStandInProvider(agent, () =>
    Promise.reject(new Error("connect ECONNREFUSED 10.0.4.12:8000"))
  );

  const [network] = await events(
    await post(app, "/v1/llm/chat", pass, JSON.stringify(chatBody))
  );

  expect(JSON.stringify(network?.data)).not.toContain("10.0.4.12");
});

test("an org may hold one big chat at a time; the next waits until the first ends", async () => {
  const { agent, app, pass } = await setup();
  let finish: () => void = () => undefined;

  const firstDone = new Promise<void>((resolve) => {
    finish = resolve;
  });

  useStandInProvider(agent, async () => {
    await firstDone;

    return okResult;
  });

  const big = JSON.stringify({
    ...chatBody,
    messages: [{ content: "A".repeat(20 * 1024 * 1024), role: "user" }],
  });

  const first = await post(app, "/v1/llm/chat", pass, big);

  expect(first.status).toBe(200);
  expect((await post(app, "/v1/llm/chat", pass, big)).status).toBe(503);

  finish();
  await first.text();

  const again = await post(app, "/v1/llm/chat", pass, big);

  expect(again.status).toBe(200);
  await again.text();
});
