import { expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentTodoState } from "./agent-todo-state";

async function createState() {
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

  return { db, state };
}

test("write replaces todos when merge is false", async () => {
  const { state, db } = await createState();

  const todos = await state.write("session_test", {
    merge: false,
    todos: [
      { id: "1", content: "First", status: "in_progress" },
      { id: "2", content: "Second", status: "pending" },
    ],
  });

  expect(todos).toHaveLength(2);
  expect(await db.getSessionTodos("session_test")).toEqual(todos);
});

test("write merges todos by id when merge is true", async () => {
  const { state, db } = await createState();

  await state.write("session_test", {
    merge: false,
    todos: [{ id: "1", content: "First", status: "in_progress" }],
  });

  const todos = await state.write("session_test", {
    merge: true,
    todos: [{ id: "1", status: "completed" }],
  });

  expect(todos).toEqual([]);
  expect(await db.getSessionTodos("session_test")).toEqual([]);
});

test("write keeps todos while work remains unfinished", async () => {
  const { state } = await createState();

  await state.write("session_test", {
    merge: false,
    todos: [
      { id: "1", content: "First", status: "completed" },
      { id: "2", content: "Second", status: "pending" },
    ],
  });

  const todos = await state.listActive("session_test");

  expect(todos).toEqual([
    { id: "1", content: "First", status: "completed" },
    { id: "2", content: "Second", status: "pending" },
  ]);
});

test("listActive clears completed-only plans from storage", async () => {
  const { db } = await createState();

  await db.updateSessionTodos("session_test", [
    { id: "1", content: "Done", status: "completed" },
  ]);

  const state = new AgentTodoState(db);
  expect(await state.listActive("session_test")).toEqual([]);
  expect(await db.getSessionTodos("session_test")).toEqual([]);
});

test("write demotes extra in_progress todos to pending", async () => {
  const { state } = await createState();

  const todos = await state.write("session_test", {
    merge: false,
    todos: [
      { id: "1", content: "First", status: "in_progress" },
      { id: "2", content: "Second", status: "in_progress" },
    ],
  });

  expect(todos.find((todo) => todo.id === "1")?.status).toBe("pending");
  expect(todos.find((todo) => todo.id === "2")?.status).toBe("in_progress");
});

test("formatForPrompt returns empty string when no todos", async () => {
  const { state } = await createState();
  expect(await state.formatForPrompt("session_test")).toBe("");
});

test("formatForPrompt renders active todos", async () => {
  const { state } = await createState();

  await state.write("session_test", {
    merge: false,
    todos: [{ id: "a", content: "Ship feature", status: "in_progress" }],
  });

  const formatted = await state.formatForPrompt("session_test");

  expect(formatted).toContain("[in progress] Ship feature");
});

test("formatForPrompt returns empty string when plan is complete", async () => {
  const { state } = await createState();

  await state.write("session_test", {
    merge: false,
    todos: [{ id: "1", content: "Done", status: "completed" }],
  });

  expect(await state.formatForPrompt("session_test")).toBe("");
});

test("list loads from database on cold cache", async () => {
  const { db } = await createState();

  await db.updateSessionTodos("session_test", [
    { id: "x", content: "Cached", status: "pending" },
  ]);

  const state = new AgentTodoState(db);
  expect(await state.list("session_test")).toEqual([
    { id: "x", content: "Cached", status: "pending" },
  ]);
});
