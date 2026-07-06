import type { AgentTodoStatus, ToolDefinition } from "@nakama/core";
import type { AgentTodoState } from "../services/agent-todo-state";

export function createTodoTools(todoState: AgentTodoState): ToolDefinition[] {
  return [
    {
      name: "todo_write",
      description:
        "Create or update the internal task plan for complex multi-step work. Use when a request has 3+ distinct steps. Initialize at the start, keep one task in_progress, and mark tasks completed as you finish them.",
      parameters: {
        type: "object",
        properties: {
          merge: {
            type: "boolean",
            description:
              "If true, update todos by id. If false, replace the entire task plan.",
          },
          todos: {
            type: "array",
            description: "Todo items to create or update.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable todo identifier." },
                content: {
                  type: "string",
                  description: "Todo description. Required when creating a new todo.",
                },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed", "cancelled"],
                  description: "Current todo status.",
                },
              },
              required: ["id", "status"],
              additionalProperties: false,
            },
          },
        },
        required: ["merge", "todos"],
        additionalProperties: false,
      },
      async run(input, context) {
        const sessionId = context.sessionId;

        if (!sessionId) {
          throw new Error("todo_write requires an active chat session.");
        }

        const merge = readBoolean(input, "merge");
        const todos = readTodoUpdates(input, "todos");

        if (merge === null || !todos) {
          throw new Error("merge and todos are required.");
        }

        const result = await todoState.write(sessionId, { merge, todos });
        return { todos: result };
      },
    },
  ];
}

function readBoolean(input: unknown, key: string): boolean | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function readTodoUpdates(
  input: unknown,
  key: string,
): Array<{ id: string; content?: string; status: AgentTodoStatus }> | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];

  if (!Array.isArray(value)) {
    return null;
  }

  const todos: Array<{ id: string; content?: string; status: AgentTodoStatus }> = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const status = record.status;

    if (!id || typeof status !== "string") {
      return null;
    }

    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "completed" &&
      status !== "cancelled"
    ) {
      return null;
    }

    const content =
      typeof record.content === "string" && record.content.trim()
        ? record.content.trim()
        : undefined;

    todos.push({ id, content, status });
  }

  return todos;
}
