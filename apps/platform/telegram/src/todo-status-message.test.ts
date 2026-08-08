import { describe, expect, test } from "bun:test";
import type { TelegramRichMessenger } from "./rich-message";
import { TelegramTodoStatusMessage } from "./todo-status-message";

function createMessenger(): TelegramRichMessenger & {
  sent: string[];
  edited: Array<{ messageId: number; text: string }>;
} {
  const sent: string[] = [];
  const edited: Array<{ messageId: number; text: string }> = [];

  return {
    async edit(messageId: number, text: string) {
      edited.push({ messageId, text });
    },
    edited,
    async send(text: string) {
      sent.push(text);
      return { message_id: 1 };
    },
    async sendPlain(text: string) {
      sent.push(text);
      return { message_id: 1 };
    },
    async sendRaw(text: string) {
      sent.push(text);
      return { message_id: 1 };
    },
    sent,
  };
}

describe("TelegramTodoStatusMessage", () => {
  test("sends first status update and edits terminal states", async () => {
    const messenger = createMessenger();
    const status = new TelegramTodoStatusMessage(messenger);

    await status.update([
      { content: "Write tests", id: "todo_1", status: "in_progress" },
    ]);
    await status.complete();

    expect(messenger.sent).toEqual(["🛠️ Working\n🔄 [~] Write tests"]);
    expect(messenger.edited).toEqual([
      { messageId: 1, text: "✅ Completed\n🔄 [~] Write tests" },
    ]);
  });

  test("skips duplicate renders", async () => {
    const messenger = createMessenger();
    const status = new TelegramTodoStatusMessage(messenger);
    const todos = [
      { content: "Write tests", id: "todo_1", status: "pending" as const },
    ];

    await status.update(todos);
    await status.update(todos);

    expect(messenger.sent).toEqual(["🛠️ Working\n⏳ [ ] Write tests"]);
    expect(messenger.edited).toEqual([]);
  });
});
