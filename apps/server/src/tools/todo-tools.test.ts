import { expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentTodoState } from "../services/agent-todo-state";
import { createTodoTools } from "./todo-tools";

async function createTool() {
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
  return { tool: tool!, state };
}

test("todo_write requires sessionId", async () => {
  const { tool } = await createTool();

  await expect(
    tool.run({ merge: false, todos: [{ id: "1", content: "A", status: "pending" }] }, {}),
  ).rejects.toThrow("requires an active chat session");
});

test("todo_write returns updated todos", async () => {
  const { tool } = await createTool();

  const result = await tool.run(
    {
      merge: false,
      todos: [
        { id: "1", content: "Explore", status: "in_progress" },
        { id: "2", content: "Implement", status: "pending" },
      ],
    },
    { sessionId: "session_test" },
  );

  expect(result).toEqual({
    todos: [
      { id: "1", content: "Explore", status: "in_progress" },
      { id: "2", content: "Implement", status: "pending" },
    ],
  });
});
