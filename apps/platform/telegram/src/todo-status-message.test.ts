import { describe, expect, test } from "bun:test";
import { TelegramTodoStatusMessage } from "./todo-status-message";
import type { TelegramRichMessenger } from "./rich-message";

function createMessenger(): TelegramRichMessenger & {
  sent: string[];
  edited: Array<{ messageId: number; text: string }>;
} {
  const sent: string[] = [];
  const edited: Array<{ messageId: number; text: string }> = [];

  return {
    sent,
    edited,
    async send(text: string) {
      sent.push(text);
      return { message_id: 1 };
    },
    async edit(messageId: number, text: string) {
      edited.push({ messageId, text });
    },
  };
}

describe("TelegramTodoStatusMessage", () => {
  test("sends first status update and edits terminal states", async () => {
    const messenger = createMessenger();
    const status = new TelegramTodoStatusMessage(messenger);

    await status.update([{ id: "todo_1", content: "Write tests", status: "in_progress" }]);
    await status.complete();

    expect(messenger.sent).toEqual(["🛠️ Working\n🔄 [~] Write tests"]);
    expect(messenger.edited).toEqual([
      { messageId: 1, text: "✅ Completed\n🔄 [~] Write tests" },
    ]);
  });

  test("skips duplicate renders", async () => {
    const messenger = createMessenger();
    const status = new TelegramTodoStatusMessage(messenger);
    const todos = [{ id: "todo_1", content: "Write tests", status: "pending" as const }];

    await status.update(todos);
    await status.update(todos);

    expect(messenger.sent).toEqual(["🛠️ Working\n⏳ [ ] Write tests"]);
    expect(messenger.edited).toEqual([]);
  });
});
