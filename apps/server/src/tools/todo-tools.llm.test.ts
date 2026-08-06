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
import { loadUserConfig, toLlmToolDefinition, type ProviderInstance } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createProviderForInstance } from "../providers/create";
import { AgentTodoState } from "../services/agent-todo-state";
import { createTodoTools } from "./todo-tools";
import { cassetteFilePath, loadCassette, withMswCassette } from "../testing/llm-msw-cassette";

const cassetteName = "todo-write-tool-call";

test("todo_write requires sessionId", async () => {
  const db = createInMemoryDatabaseAdapter();
  const state = new AgentTodoState(db);

  await db.upsertSession({
    id: "session_test",
    profileId: "default",
    channel: "web",
    createdAt: new Date().toISOString(),
    title: null,
    agentTodos: [],
    agentQuestionnaire: null,
  });

  const tool = createTodoTools(state).find((entry) => entry.name === "todo_write");
  if (!tool) {
    throw new Error("todo_write tool missing");
  }

  await expect(
    tool.run({ merge: false, todos: [{ id: "1", content: "A", status: "pending" }] }, {}),
  ).rejects.toThrow("requires an active chat session");
});

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

test("todo_write schema is callable by a real OpenAI model", async () => {
  const cassettePath = cassetteFilePath(cassetteName);
  const existing = await loadCassette(cassettePath);
  const mode = process.env.LLM_VCR_MODE?.trim().toLowerCase();
  const instance = await resolveOpenAiInstance();

  if (!existing && mode !== "record" && !instance) {
    throw new Error(
      "Missing OpenAI credentials to record todo_write cassette. Set OPENAI_API_KEY or configure an OpenAI provider, then run with LLM_VCR_MODE=record.",
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
    const state = new AgentTodoState(db);
    await db.upsertSession({
      id: "session_llm",
      profileId: "default",
      channel: "web",
      createdAt: new Date().toISOString(),
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });

    const tool = createTodoTools(state).find((entry) => entry.name === "todo_write");
    if (!tool) {
      throw new Error("todo_write tool missing");
    }

    const result = await liveProvider.generateChat({
      system:
        "You are a helpful assistant. For complex multi-step requests, you must call the todo_write tool to create an internal task plan before doing the work. Use merge=false for the initial plan. Keep exactly one task in_progress. Do not answer in plain text.",
      messages: [
        {
          role: "user",
          content:
            "Plan how you would research, draft, and review a short blog post about TypeScript enums. Use the todo_write tool with at least 3 tasks.",
        },
      ],
      tools: [toLlmToolDefinition(tool)],
    });

    const toolCall = result.toolCalls?.[0];
    expect(toolCall?.name).toBe("todo_write");

    const args = toolCall?.arguments ?? {};
    expect(typeof args.merge).toBe("boolean");
    expect(Array.isArray(args.todos)).toBe(true);

    const todos = args.todos;
    if (!Array.isArray(todos) || todos.length < 3) {
      throw new Error(`expected todo_write todos array with 3+ items, got ${JSON.stringify(args)}`);
    }

    for (const item of todos) {
      expect(typeof item === "object" && item !== null).toBe(true);
      const todo = item as Record<string, unknown>;
      expect(typeof todo.id).toBe("string");
      expect(typeof todo.content).toBe("string");
      expect(typeof todo.status).toBe("string");
      expect(["pending", "in_progress", "completed", "cancelled"]).toContain(
        todo.status as string,
      );
    }

    const inProgress = todos.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).status === "in_progress",
    );
    expect(inProgress.length).toBeGreaterThanOrEqual(1);

    const stored = await tool.run(args, { sessionId: "session_llm" });
    expect(stored).toHaveProperty("todos");
    expect(Array.isArray((stored as { todos: unknown }).todos)).toBe(true);
    expect(((stored as { todos: unknown[] }).todos).length).toBeGreaterThanOrEqual(3);
  });
});
