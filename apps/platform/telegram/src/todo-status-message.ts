import type { AgentTodo } from "@tinyclaw/core/contract";
import type { TelegramRichMessenger } from "./rich-message";
import { renderTelegramTodoStatus } from "./format";

type TelegramTodoRunState = "working" | "completed" | "stopped" | "failed";

interface TelegramReplyMessage {
  message_id: number;
}

export class TelegramTodoStatusMessage {
  private messageId: number | null = null;
  private lastRendered = "";
  private lastTodos: AgentTodo[] = [];
  private pending = Promise.resolve();

  constructor(private readonly messenger: TelegramRichMessenger) {}

  async update(todos: AgentTodo[]): Promise<void> {
    if (todos.length === 0) {
      return;
    }

    this.lastTodos = todos.map((todo) => ({ ...todo }));
    await this.enqueueRender("working", this.lastTodos);
  }

  async complete(): Promise<void> {
    await this.enqueueTerminalState("completed");
  }

  async stop(): Promise<void> {
    await this.enqueueTerminalState("stopped");
  }

  async fail(): Promise<void> {
    await this.enqueueTerminalState("failed");
  }

  private async enqueueTerminalState(state: TelegramTodoRunState): Promise<void> {
    if (this.lastTodos.length === 0) {
      return;
    }

    await this.enqueueRender(state, this.lastTodos);
  }

  private async enqueueRender(state: TelegramTodoRunState, todos: AgentTodo[]): Promise<void> {
    this.pending = this.pending.then(() => this.render(state, todos));
    await this.pending;
  }

  private async render(state: TelegramTodoRunState, todos: AgentTodo[]): Promise<void> {
    const next = renderTelegramTodoStatus(todos, state);

    if (next === this.lastRendered) {
      return;
    }

    try {
      if (this.messageId === null) {
        const message = await this.messenger.send(next);
        this.messageId = message?.message_id ?? null;
      } else {
        await this.messenger.edit(this.messageId, next);
      }

      this.lastRendered = next;
    } catch {
      // Status updates are best-effort only.
    }
  }
}
