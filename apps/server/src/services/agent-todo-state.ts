import {
  finalizeAgentTodosIfComplete,
  hasActiveAgentTodos,
  type AgentTodo,
  type AgentTodoStatus,
} from "@tinyclaw/core";
import type { DatabaseAdapter } from "@tinyclaw/db";

const MAX_TODOS = 20;

const VALID_STATUSES = new Set<AgentTodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export interface TodoWriteInput {
  merge: boolean;
  todos: Array<{
    id: string;
    content?: string;
    status: AgentTodoStatus;
  }>;
}

export class AgentTodoState {
  private readonly cache = new Map<string, AgentTodo[]>();

  constructor(private readonly db: DatabaseAdapter) {}

  async list(sessionId: string): Promise<AgentTodo[]> {
    const cached = this.cache.get(sessionId);

    if (cached) {
      return [...cached];
    }

    const todos = await this.db.getSessionTodos(sessionId);
    this.cache.set(sessionId, todos);
    return [...todos];
  }

  async write(sessionId: string, input: TodoWriteInput): Promise<AgentTodo[]> {
    const updates = input.todos.map((todo) => ({
      id: todo.id.trim(),
      content: todo.content?.trim(),
      status: todo.status,
    }));

    for (const update of updates) {
      if (!update.id) {
        throw new Error("Each todo must have a non-empty id.");
      }

      if (!VALID_STATUSES.has(update.status)) {
        throw new Error(`Invalid todo status: ${update.status}`);
      }
    }

    let next: AgentTodo[];

    if (input.merge) {
      const current = await this.list(sessionId);
      const byId = new Map(current.map((todo) => [todo.id, todo]));

      for (const update of updates) {
        const existing = byId.get(update.id);

        if (!existing && !update.content) {
          throw new Error(`content is required when creating todo "${update.id}".`);
        }

        byId.set(update.id, {
          id: update.id,
          content: update.content ?? existing?.content ?? "",
          status: update.status,
        });
      }

      next = Array.from(byId.values());
    } else {
      for (const update of updates) {
        if (!update.content) {
          throw new Error(`content is required for todo "${update.id}".`);
        }
      }

      next = updates.map((update) => ({
        id: update.id,
        content: update.content!,
        status: update.status,
      }));
    }

    if (next.length > MAX_TODOS) {
      throw new Error(`A session can have at most ${MAX_TODOS} todos.`);
    }

    const inProgressIds = next
      .filter((todo) => todo.status === "in_progress")
      .map((todo) => todo.id);

    if (inProgressIds.length > 1) {
      const keep = inProgressIds[inProgressIds.length - 1]!;
      next = next.map((todo) =>
        todo.status === "in_progress" && todo.id !== keep
          ? { ...todo, status: "pending" as const }
          : todo,
      );
    }

    next = finalizeAgentTodosIfComplete(next);

    this.cache.set(sessionId, next);
    await this.db.updateSessionTodos(sessionId, next);
    return [...next];
  }

  async listActive(sessionId: string): Promise<AgentTodo[]> {
    const todos = await this.list(sessionId);

    if (!hasActiveAgentTodos(todos)) {
      if (todos.length > 0) {
        await this.clearTodos(sessionId);
      }

      return [];
    }

    return todos;
  }

  async formatForPrompt(sessionId: string): Promise<string> {
    const todos = await this.listActive(sessionId);

    if (todos.length === 0) {
      return "";
    }

    const lines = todos.map((todo) => {
      const label =
        todo.status === "in_progress"
          ? "[in progress]"
          : todo.status === "completed"
            ? "[done]"
            : todo.status === "cancelled"
              ? "[cancelled]"
              : "[pending]";
      return `- ${label} ${todo.content} (id: ${todo.id})`;
    });

    return [
      "# Active Task Plan",
      "Finish remaining pending or in_progress tasks before starting unrelated work unless the user redirects you.",
      ...lines,
    ].join("\n");
  }

  clearSession(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  private async clearTodos(sessionId: string): Promise<void> {
    this.cache.set(sessionId, []);
    await this.db.updateSessionTodos(sessionId, []);
  }
}
