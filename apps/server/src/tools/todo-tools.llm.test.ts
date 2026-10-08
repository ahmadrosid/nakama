/**
 * Live LLM cassette test for todo_write.
 *
 * Uses MSW to record once / replay forever (any host MSW can match).
 *
 * Record (needs OPENAI key in ~/.nakama config, or OPENAI_API_KEY):
 *   LLM_VCR_MODE=record bun test src/tools/todo-tools.llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test src/tools/todo-tools.llm.test.ts
 */
import { expect, test } from "bun:test";
import {
  loadUserConfig,
  type ProviderInstance,
  toLlmToolDefinition,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { createProviderForInstance } from "../providers/create";
import { AgentTodoState } from "../services/agent-todo-state";
import {
  cassetteFilePath,
  loadCassette,
  withMswCassette,
} from "../testing/llm-msw-cassette";
import { createTodoTools } from "./todo-tools";

const cassetteName = "todo-write-tool-call";

const TodoCallSchema = z.object({
  merge: z.boolean(),
  todos: z.array(
    z.object({
      content: z.string(),
      id: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    })
  ),
});

test("todo_write requires sessionId", async () => {
  const db = createInMemoryDatabaseAdapter();
  const state = new AgentTodoState(db);

  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: new Date().toISOString(),
    id: "session_test",
    model: null,
    profileId: "default",
    title: null,
  });

  const tool = createTodoTools(state).find(
    (entry) => entry.name === "todo_write"
  );

  if (!tool) {
    throw new Error("todo_write tool missing");
  }

  await expect(
    tool.run(
      { merge: false, todos: [{ content: "A", id: "1", status: "pending" }] },
      {}
    )
  ).rejects.toThrow("requires an active chat session");
});

async function resolveOpenAiInstance(): Promise<ProviderInstance | null> {
  const config = await loadUserConfig();

  const configured =
    config?.providers.find(
      (provider) => provider.type === "openai" && provider.apiKey.trim()
    ) ?? null;

  if (configured) {
    return configured;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    createdAt: new Date().toISOString(),
    id: "env-openai",
    label: "OpenAI",
    type: "openai",
  };
}

test("todo_write schema is callable by a real OpenAI model", async () => {
  const cassettePath = cassetteFilePath(cassetteName);
  const existing = await loadCassette(cassettePath);
  const mode = process.env.LLM_VCR_MODE?.trim().toLowerCase();
  const instance = await resolveOpenAiInstance();

  if (!existing && mode !== "record" && !instance) {
    throw new Error(
      "Missing OpenAI credentials to record todo_write cassette. Set OPENAI_API_KEY or configure an OpenAI provider, then run with LLM_VCR_MODE=record."
    );
  }

  await withMswCassette(cassetteName, async () => {
    const liveProvider = createProviderForInstance(
      instance ?? {
        apiKey: "sk-replay-placeholder",
        createdAt: new Date().toISOString(),
        id: "replay-openai",
        label: "OpenAI",
        type: "openai",
      },
      "gpt-4o-mini"
    );

    if (!liveProvider) {
      throw new Error("Failed to construct OpenAI provider.");
    }

    const db = createInMemoryDatabaseAdapter();
    const state = new AgentTodoState(db);
    await db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: new Date().toISOString(),
      id: "session_llm",
      model: null,
      profileId: "default",
      title: null,
    });

    const tool = createTodoTools(state).find(
      (entry) => entry.name === "todo_write"
    );

    if (!tool) {
      throw new Error("todo_write tool missing");
    }

    const result = await liveProvider.generateChat({
      messages: [
        {
          content:
            "Plan how you would research, draft, and review a short blog post about TypeScript enums. Use the todo_write tool with at least 3 tasks.",
          role: "user",
        },
      ],
      system:
        "You are a helpful assistant. For complex multi-step requests, you must call the todo_write tool to create an internal task plan before doing the work. Use merge=false for the initial plan. Keep exactly one task in_progress. Do not answer in plain text.",
      tools: [toLlmToolDefinition(tool)],
    });

    const toolCall = result.toolCalls?.[0];
    expect(toolCall?.name).toBe("todo_write");

    const parsedArgs = TodoCallSchema.safeParse(toolCall?.arguments);

    if (!parsedArgs.success || parsedArgs.data.todos.length < 3) {
      throw new Error(
        `expected todo_write todos array with 3+ items, got ${JSON.stringify(toolCall?.arguments)}`
      );
    }

    const { todos } = parsedArgs.data;

    const inProgress = todos.filter((item) => item.status === "in_progress");

    expect(inProgress.length).toBeGreaterThanOrEqual(1);

    const stored = await tool.run(parsedArgs.data, {
      sessionId: "session_llm",
    });

    const storedTodos = TodoCallSchema.shape.todos.parse(stored.todos);

    expect(storedTodos.length).toBeGreaterThanOrEqual(3);
  });
});
