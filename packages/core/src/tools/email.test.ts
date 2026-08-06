import { describe, expect, test } from "bun:test";
import type { EmailConfigFile } from "../email-config";
import {
  createFakeMailReader,
  createFakeMailSender,
  emailParameters,
  emailTool,
  runEmailTool,
} from "./email";
import { builtinTools } from "./builtin";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??= "test-email-attachment-secret-32-chars";

const completeConfig: EmailConfigFile = {
  imapHost: "imap.example.com",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  username: "user@example.com",
  password: "secret-password",
  from: "user@example.com",
  fromName: "",
};

describe("email tool", () => {
  test("exposes an OpenAI-compatible object parameters schema", () => {
    const parameters = emailParameters();
    const schema = parameters as Record<string, unknown>;

    expect(parameters.type).toBe("object");
    expect(schema.oneOf).toBeUndefined();
    expect(schema.anyOf).toBeUndefined();
    expect(parameters.properties?.action).toEqual({
      type: "string",
      enum: ["list", "read", "search", "send"],
    });
    expect(parameters.required).toContain("action");
    expect(emailTool.parameters).toEqual(parameters);
  });

  test("builtin tool schemas all declare type object for LLM providers", () => {
    for (const tool of builtinTools) {
      expect(tool.parameters?.type, `${tool.name} parameters.type`).toBe("object");
      const schema = tool.parameters as Record<string, unknown> | undefined;
      expect(schema?.oneOf, `${tool.name} oneOf`).toBeUndefined();
      expect(schema?.anyOf, `${tool.name} anyOf`).toBeUndefined();
    }
  });

  test("strips cross-action fields advertised by the flat LLM schema", async () => {
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      {
        action: "send",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Body",
        folder: "INBOX",
        limit: 20,
        uid: 99,
        query: "noise",
      },
      {
        loadConfig: async () => completeConfig,
        createSender: () => sender,
      },
    );

    expect("sent" in result && result.sent?.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
  });

  test("returns configuration error when mailbox is incomplete", async () => {
    const reader = createFakeMailReader();
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      { action: "send", to: "a@b.com", subject: "Hi", text: "Hello" },
      {
        loadConfig: async () => null,
        createReader: () => reader,
        createSender: () => sender,
      },
    );

    expect(result).toEqual({
      error:
        "Email is not configured. Ask an org admin to set up mailbox settings in System → Tools.",
    });
    expect(sender.sent).toHaveLength(0);
  });

  test("lists messages with fake reader", async () => {
    const reader = createFakeMailReader([
      {
        uid: 10,
        subject: "Weekly update",
        from: "team@example.com",
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        text: "summary",
      },
    ]);

    const result = await runEmailTool(
      { action: "list", limit: 5 },
      {
        loadConfig: async () => completeConfig,
        createReader: () => reader,
      },
    );

    expect("messages" in result && result.messages).toHaveLength(1);
  });

  test("reads a message by uid", async () => {
    const reader = createFakeMailReader([
      {
        uid: 42,
        subject: "Details",
        from: "team@example.com",
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        text: "full body",
      },
    ]);

    const result = await runEmailTool(
      { action: "read", uid: 42 },
      {
        loadConfig: async () => completeConfig,
        createReader: () => reader,
      },
    );

    expect("message" in result && result.message?.text).toBe("full body");
  });

  test("returns scoped references for message attachments", async () => {
    const reader = createFakeMailReader([
      {
        uid: 43,
        subject: "Report",
        from: "team@example.com",
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        attachments: [
          {
            id: "0",
            filename: "report.pdf",
            mediaType: "application/pdf",
            size: 123,
            disposition: "attachment",
          },
        ],
      },
    ]);

    const result = await runEmailTool(
      { action: "read", uid: 43 },
      {
        loadConfig: async () => completeConfig,
        createReader: () => reader,
      },
      { orgId: "org_test", profileId: "profile_test", sessionId: "session_test" },
    );

    expect("message" in result && result.message?.attachments?.[0]).toMatchObject({
      filename: "report.pdf",
      mediaType: "application/pdf",
      size: 123,
      disposition: "attachment",
    });
    expect("message" in result && result.message?.attachments?.[0]?.documentRef).toContain(".");
  });

  test("searches messages", async () => {
    const reader = createFakeMailReader([
      {
        uid: 1,
        subject: "Invoice",
        from: "billing@example.com",
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        text: "due now",
      },
    ]);

    const result = await runEmailTool(
      { action: "search", query: "invoice" },
      {
        loadConfig: async () => completeConfig,
        createReader: () => reader,
      },
    );

    expect("messages" in result && result.messages?.[0]?.subject).toBe("Invoice");
  });

  test("sends email with fake sender", async () => {
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      {
        action: "send",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Body",
      },
      {
        loadConfig: async () => completeConfig,
        createSender: () => sender,
      },
    );

    expect("sent" in result && result.sent?.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
  });

  test("rejects invalid recipient", async () => {
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      {
        action: "send",
        to: "not-an-email",
        subject: "Hello",
        text: "Body",
      },
      {
        loadConfig: async () => completeConfig,
        createSender: () => sender,
      },
    );

    expect(result).toEqual({ error: "Invalid recipient email address." });
  });

  test("requires text body for send", async () => {
    await expect(
      runEmailTool(
        {
          action: "send",
          to: "recipient@example.com",
          subject: "Hello",
        },
        {
          loadConfig: async () => completeConfig,
          createSender: () => createFakeMailSender(),
        },
      ),
    ).rejects.toThrow("text is required.");
  });

  test("sanitizes sender errors", async () => {
    const result = await runEmailTool(
      {
        action: "send",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Body",
      },
      {
        loadConfig: async () => completeConfig,
        createSender: () => ({
          async send() {
            throw new Error("SMTP auth failed password=secret-password");
          },
        }),
      },
    );

    expect(result).toEqual({ error: "SMTP auth failed password=[REDACTED]" });
  });
});
