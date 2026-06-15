import type { AgentTodo } from "@tinyclaw/core/contract";
import type { WASocket } from "@whiskeysockets/baileys";
import { renderWhatsAppTodoStatus } from "./format";

type WhatsAppTodoRunState = "working" | "completed" | "stopped" | "failed";

export class WhatsAppTodoStatusMessage {
  private lastRendered = "";
  private lastTodos: AgentTodo[] = [];
  private pending = Promise.resolve();

  constructor(
    private readonly socket: WASocket | null,
    private readonly jid: string,
  ) {}

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

  private async enqueueTerminalState(state: WhatsAppTodoRunState): Promise<void> {
    if (this.lastTodos.length === 0) {
      return;
    }

    await this.enqueueRender(state, this.lastTodos);
  }

  private async enqueueRender(state: WhatsAppTodoRunState, todos: AgentTodo[]): Promise<void> {
    this.pending = this.pending.then(() => this.render(state, todos));
    await this.pending;
  }

  private async render(state: WhatsAppTodoRunState, todos: AgentTodo[]): Promise<void> {
    const next = renderWhatsAppTodoStatus(todos, state);

    if (next === this.lastRendered) {
      return;
    }

    try {
      if (!this.socket) return;

      await this.socket.sendMessage(this.jid, { text: next });
      this.lastRendered = next;
    } catch {
      // Status updates are best-effort only.
    }
  }
}