import type { AgentTodo } from "./contract";

export function hasActiveAgentTodos(todos: readonly AgentTodo[]): boolean {
  return todos.some(
    (todo) => todo.status === "pending" || todo.status === "in_progress",
  );
}

export function finalizeAgentTodosIfComplete(todos: AgentTodo[]): AgentTodo[] {
  if (todos.length === 0 || hasActiveAgentTodos(todos)) {
    return todos;
  }

  return [];
}
