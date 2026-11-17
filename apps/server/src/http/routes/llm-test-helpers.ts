import type { ProviderClient, UserConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { AgentService } from "../../services/agent-service";
import {
  ComputerAuthService,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";
import { LlmUsageTracker } from "../../services/llm-usage-tracker";
import { testDeviceKey } from "../../testing/computer-device";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedOrgAdmin } from "../test-session-helpers";

/** Shared setup for the /v1/llm route tests: a member, a computer, a pass. */

export const eventSchema = z.object({ data: z.unknown(), type: z.string() });

export async function setup() {
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

  /** A pass for this member's computer in one of their orgs. */
  const passIn = async (inOrgId: string, installId: string) => {
    const key = testDeviceKey();

    const enrolled = await computerAuth.enroll({
      installId,
      name: "Ada's MacBook",
      orgId: inOrgId,
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

    return z.object({ pass: z.string() }).parse(await tokenResponse.json())
      .pass;
  };

  const pass = await passIn(orgId, "install_1");

  return {
    agent,
    app,
    databaseAdapter,
    orgId,
    pass,
    passIn,
    usageTracker,
    userId,
  };
}

export function post(
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

export const chatBody = {
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

/** Points the desktop harness at a stand-in provider for one test. */
export function useStandInProvider(
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

export const okResult = {
  assistantMessage: { content: "ok", role: "assistant" as const },
  content: "ok",
  toolCalls: [],
};

export async function events(response: Response) {
  return (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => eventSchema.parse(JSON.parse(frame.slice(6))));
}
