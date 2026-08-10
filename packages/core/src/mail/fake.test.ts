import { describe, expect, test } from "bun:test";
import { createFakeMailReader, createFakeMailSender } from "./fake";
import { sanitizeMailError } from "./sanitize";

describe("mail fakes", () => {
  test("list, read, and search messages", async () => {
    const reader = createFakeMailReader([
      {
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        from: "alice@example.com",
        subject: "Hello world",
        text: "hello there",
        uid: 1,
      },
      {
        date: "2026-06-21T01:00:00.000Z",
        folder: "INBOX",
        from: "billing@example.com",
        subject: "Billing update",
        text: "invoice attached",
        uid: 2,
      },
    ]);

    await reader.connect();

    const listed = await reader.listMessages("INBOX", 10);
    expect(listed).toHaveLength(2);

    const read = await reader.readMessage("INBOX", 1);
    expect(read?.text).toBe("hello there");

    const searched = await reader.searchMessages("INBOX", "billing", 10);
    expect(searched).toHaveLength(1);
    expect(searched[0]?.subject).toBe("Billing update");

    await reader.disconnect();
  });

  test("records sent messages", async () => {
    const sender = createFakeMailSender();
    const result = await sender.send({
      subject: "Test",
      text: "Hello",
      to: "recipient@example.com",
    });

    expect(result.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("recipient@example.com");
  });
});

describe("sanitizeMailError", () => {
  test("redacts password-like content", () => {
    expect(sanitizeMailError(new Error("AUTH failed password=abcd1234"))).toBe(
      "AUTH failed password=[REDACTED]"
    );
  });
});
