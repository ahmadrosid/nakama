import { expect, test } from "bun:test";
import {
  finalizeAgentTodosIfComplete,
  hasActiveAgentTodos,
} from "./agent-todo";

test("hasActiveAgentTodos is true when pending or in_progress remain", () => {
  expect(
    hasActiveAgentTodos([
      { content: "Done", id: "1", status: "completed" },
      { content: "Next", id: "2", status: "pending" },
    ])
  ).toBe(true);
});

test("hasActiveAgentTodos is false when all todos are terminal", () => {
  expect(
    hasActiveAgentTodos([
      { content: "Done", id: "1", status: "completed" },
      { content: "Skip", id: "2", status: "cancelled" },
    ])
  ).toBe(false);
});

test("finalizeAgentTodosIfComplete clears terminal-only plans", () => {
  expect(
    finalizeAgentTodosIfComplete([
      { content: "Done", id: "1", status: "completed" },
    ])
  ).toEqual([]);
});

test("finalizeAgentTodosIfComplete keeps active plans", () => {
  const todos = [
    { content: "Done", id: "1", status: "completed" as const },
    { content: "Next", id: "2", status: "pending" as const },
  ];

  expect(finalizeAgentTodosIfComplete(todos)).toEqual(todos);
});
