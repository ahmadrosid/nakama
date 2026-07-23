/**
 * Live LLM cassette test for ask_user_question.
 *
 * Uses MSW to record once / replay forever (any host MSW can match).
 *
 * Record (needs OPENAI key in ~/.nakama config, or OPENAI_API_KEY):
 *   LLM_VCR_MODE=record bun test src/tools/ask-user-question-tool.llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test src/tools/ask-user-question-tool.llm.test.ts
 */
import { expect, test } from "bun:test";
import { loadUserConfig, toLlmToolDefinition, type ProviderInstance } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createProviderForInstance } from "../providers/create";
import { AgentQuestionnaireState } from "../services/agent-questionnaire-state";
import { createAskUserQuestionTools } from "./ask-user-question-tool";
import { cassetteFilePath, loadCassette, withMswCassette } from "./llm-msw-cassette";

const cassettesDir = `${import.meta.dir}/__cassettes__`;
const cassetteName = "ask-user-question-tool-call";

async function resolveOpenAiInstance(): Promise<ProviderInstance | null> {
  const config = await loadUserConfig();
  const configured =
    config?.providers.find((provider) => provider.type === "openai" && provider.apiKey.trim()) ??
    null;

  if (configured) {
    return configured;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    id: "env-openai",
    type: "openai",
    label: "OpenAI",
    apiKey,
    createdAt: new Date().toISOString(),
  };
}

test("ask_user_question schema is callable by a real OpenAI model", async () => {
  const cassettePath = cassetteFilePath(cassettesDir, cassetteName);
  const existing = await loadCassette(cassettePath);
  const mode = process.env.LLM_VCR_MODE?.trim().toLowerCase();
  const instance = await resolveOpenAiInstance();

  if (!existing && mode !== "record" && !instance) {
    throw new Error(
      "Missing OpenAI credentials to record ask_user_question cassette. Set OPENAI_API_KEY or configure an OpenAI provider, then run with LLM_VCR_MODE=record.",
    );
  }

  await withMswCassette(cassetteName, async () => {
    const liveProvider = createProviderForInstance(
      instance ?? {
        id: "replay-openai",
        type: "openai",
        label: "OpenAI",
        apiKey: "sk-replay-placeholder",
        createdAt: new Date().toISOString(),
      },
      "gpt-4o-mini",
    );

    if (!liveProvider) {
      throw new Error("Failed to construct OpenAI provider.");
    }

    const db = createInMemoryDatabaseAdapter();
    const state = new AgentQuestionnaireState(db);
    await db.upsertSession({
      id: "session_llm",
      profileId: "default",
      channel: "web",
      createdAt: new Date().toISOString(),
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });

    const tool = createAskUserQuestionTools(state).find(
      (entry) => entry.name === "ask_user_question",
    );
    if (!tool) {
      throw new Error("ask_user_question tool missing");
    }

    const result = await liveProvider.generateChat({
      system:
        "You are a helpful assistant. When you need information from the user, you must call the ask_user_question tool. Prefer 2-4 choices per question. Do not answer in plain text.",
      messages: [
        {
          role: "user",
          content:
            "Before you help me schedule anything, ask what timezone I am in. Use the ask_user_question tool with at most 4 choices.",
        },
      ],
      tools: [toLlmToolDefinition(tool)],
    });

    const toolCall = result.toolCalls?.[0];
    expect(toolCall?.name).toBe("ask_user_question");

    const args = toolCall?.arguments ?? {};
    expect(typeof args.title).toBe("string");
    expect(Array.isArray(args.questions)).toBe(true);

    const questions = args.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error(
        `expected ask_user_question questions array, got ${JSON.stringify(args)}`,
      );
    }
    const first = questions[0];
    expect(typeof first === "object" && first !== null).toBe(true);
    const question = first as Record<string, unknown>;
    expect(typeof question.prompt).toBe("string");
    expect(Array.isArray(question.choices)).toBe(true);
    expect(typeof (question.choices as unknown[])[0]).toBe("string");

    const stored = await tool.run(args, { sessionId: "session_llm" });
    expect(stored).toHaveProperty("questionnaire");
  }, { cassettesDir });
});
