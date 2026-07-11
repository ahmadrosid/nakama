import type { AgentTodo } from "@nakama/core/contract";
import type { DiscordMessenger } from "./messenger";
import { renderDiscordTodoStatus } from "./format";

type DiscordTodoRunState = "working" | "completed" | "stopped" | "failed";

export class DiscordTodoStatusMessage {
  private messageId: string | null = null;
  private lastRendered = "";
  private lastTodos: AgentTodo[] = [];
  private pending = Promise.resolve();

  constructor(private readonly messenger: DiscordMessenger) {}

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

  private async enqueueTerminalState(state: DiscordTodoRunState): Promise<void> {
    if (this.lastTodos.length === 0) {
      return;
    }

    await this.enqueueRender(state, this.lastTodos);
  }

  private async enqueueRender(state: DiscordTodoRunState, todos: AgentTodo[]): Promise<void> {
    this.pending = this.pending.then(() => this.render(state, todos));
    await this.pending;
  }

  private async render(state: DiscordTodoRunState, todos: AgentTodo[]): Promise<void> {
    const next = renderDiscordTodoStatus(todos, state);

    if (next === this.lastRendered) {
      return;
    }

    try {
      if (this.messageId === null) {
        const message = await this.messenger.send(next);
        this.messageId = message?.id ?? null;
      } else {
        await this.messenger.edit(this.messageId, next);
      }

      this.lastRendered = next;
    } catch {
      // Status updates are best-effort only.
    }
  }
}
