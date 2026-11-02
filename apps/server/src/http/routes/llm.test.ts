import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { UserConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";
import { AgentService } from "../../services/agent-service";
import { ComputerAuthService } from "../../services/computer-auth";
import { LlmUsageTracker } from "../../services/llm-usage-tracker";
import { testDeviceKey } from "../../testing/computer-device";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedOrgAdmin } from "../test-session-helpers";
import { LLM_TOKEN_PATH } from "./llm";

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

  const computer = await computerAuth.enroll({
    installId: "install_1",
    name: "Ada's MacBook",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

  const tokenResponse = await app.request(LLM_TOKEN_PATH, {
    body: JSON.stringify(key.signRequest(computer.id)),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  const { pass } = z
    .object({ pass: z.string() })
    .parse(await tokenResponse.json());

  return { app, databaseAdapter, orgId, pass, usageTracker, userId };
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
