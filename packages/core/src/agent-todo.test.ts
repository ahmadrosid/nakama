import { expect, test } from "bun:test";
import { finalizeAgentTodosIfComplete, hasActiveAgentTodos } from "./agent-todo";

test("hasActiveAgentTodos is true when pending or in_progress remain", () => {
  expect(
    hasActiveAgentTodos([
      { id: "1", content: "Done", status: "completed" },
      { id: "2", content: "Next", status: "pending" },
    ]),
  ).toBe(true);
});

test("hasActiveAgentTodos is false when all todos are terminal", () => {
  expect(
    hasActiveAgentTodos([
      { id: "1", content: "Done", status: "completed" },
      { id: "2", content: "Skip", status: "cancelled" },
    ]),
  ).toBe(false);
});

test("finalizeAgentTodosIfComplete clears terminal-only plans", () => {
  expect(
    finalizeAgentTodosIfComplete([
      { id: "1", content: "Done", status: "completed" },
    ]),
  ).toEqual([]);
});

test("finalizeAgentTodosIfComplete keeps active plans", () => {
  const todos = [
    { id: "1", content: "Done", status: "completed" as const },
    { id: "2", content: "Next", status: "pending" as const },
  ];

  expect(finalizeAgentTodosIfComplete(todos)).toEqual(todos);
});
