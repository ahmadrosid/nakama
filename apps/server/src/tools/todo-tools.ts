import type { ToolDefinition } from "@nakama/core";
import { z } from "zod";
import type { AgentTodoState } from "../services/agent-todo-state";

const TodoUpdatesSchema = z.array(
  z.object({
    content: z
      .string()
      .optional()
      .transform((content) => content?.trim() || undefined),
    id: z
      .string()
      .transform((id) => id.trim())
      .pipe(z.string().min(1)),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  })
);

const TodoWriteInputSchema = z.object({
  merge: z.boolean().optional(),
  todos: TodoUpdatesSchema.optional(),
});

export function createTodoTools(todoState: AgentTodoState): ToolDefinition[] {
  return [
    {
      description:
        "Create or update the internal task plan for complex multi-step work. Use when a request has 3+ distinct steps. Initialize at the start, keep one task in_progress, and mark tasks completed as you finish them.",
      name: "todo_write",
      parameters: {
        additionalProperties: false,
        properties: {
          merge: {
            description:
              "If true, update todos by id. If false, replace the entire task plan.",
            type: "boolean",
          },
          todos: {
            description: "Todo items to create or update.",
            items: {
              additionalProperties: false,
              properties: {
                content: {
                  description:
                    "Todo description. Required when creating a new todo.",
                  type: "string",
                },
                id: { description: "Stable todo identifier.", type: "string" },
                status: {
                  description: "Current todo status.",
                  enum: ["pending", "in_progress", "completed", "cancelled"],
                  type: "string",
                },
              },
              required: ["id", "status"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["merge", "todos"],
        type: "object",
      },
      async run(input, context) {
        const sessionId = context.sessionId;

        if (!sessionId) {
          throw new Error("todo_write requires an active chat session.");
        }

        const parsedInput = TodoWriteInputSchema.safeParse(input);

        if (
          !parsedInput.success ||
          parsedInput.data.merge === undefined ||
          !parsedInput.data.todos
        ) {
          throw new Error("merge and todos are required.");
        }

        const result = await todoState.write(sessionId, {
          merge: parsedInput.data.merge,
          todos: parsedInput.data.todos,
        });

        return { todos: result };
      },
    },
  ];
}
