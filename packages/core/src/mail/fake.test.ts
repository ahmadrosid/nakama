import { describe, expect, test } from "bun:test";
import { createFakeMailReader, createFakeMailSender } from "./fake";
import { sanitizeMailError } from "./sanitize";

describe("mail fakes", () => {
  test("list, read, and search messages", async () => {
    const reader = createFakeMailReader([
      {
        uid: 1,
        subject: "Hello world",
        from: "alice@example.com",
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        text: "hello there",
      },
      {
        uid: 2,
        subject: "Billing update",
        from: "billing@example.com",
        date: "2026-06-21T01:00:00.000Z",
        folder: "INBOX",
        text: "invoice attached",
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
      to: "recipient@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(result.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("recipient@example.com");
  });
});

describe("sanitizeMailError", () => {
  test("redacts password-like content", () => {
    expect(sanitizeMailError(new Error("AUTH failed password=abcd1234"))).toBe(
      "AUTH failed password=[REDACTED]",
    );
  });
});
