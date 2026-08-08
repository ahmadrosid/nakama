import { describe, expect, test } from "bun:test";
import type { EmailConfigFile } from "../email-config";
import { builtinTools } from "./builtin";
import {
  createFakeMailReader,
  createFakeMailSender,
  emailParameters,
  emailTool,
  runEmailTool,
} from "./email";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??=
  "test-email-attachment-secret-32-chars";

const completeConfig: EmailConfigFile = {
  from: "user@example.com",
  fromName: "",
  imapHost: "imap.example.com",
  imapPort: 993,
  imapSecure: true,
  password: "secret-password",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  username: "user@example.com",
};

describe("email tool", () => {
  test("exposes an OpenAI-compatible object parameters schema", () => {
    const parameters = emailParameters();
    const schema = parameters as Record<string, unknown>;

    expect(parameters.type).toBe("object");
    expect(schema.oneOf).toBeUndefined();
    expect(schema.anyOf).toBeUndefined();
    expect(parameters.properties?.action).toEqual({
      enum: ["list", "read", "search", "send"],
      type: "string",
    });
    expect(parameters.required).toContain("action");
    expect(emailTool.parameters).toEqual(parameters);
  });

  test("builtin tool schemas all declare type object for LLM providers", () => {
    for (const tool of builtinTools) {
      expect(tool.parameters?.type, `${tool.name} parameters.type`).toBe(
        "object"
      );
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
        folder: "INBOX",
        limit: 20,
        query: "noise",
        subject: "Hello",
        text: "Body",
        to: "recipient@example.com",
        uid: 99,
      },
      {
        createSender: () => sender,
        loadConfig: async () => completeConfig,
      }
    );

    expect("sent" in result && result.sent?.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
  });

  test("returns configuration error when mailbox is incomplete", async () => {
    const reader = createFakeMailReader();
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      { action: "send", subject: "Hi", text: "Hello", to: "a@b.com" },
      {
        createReader: () => reader,
        createSender: () => sender,
        loadConfig: async () => null,
      }
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
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        from: "team@example.com",
        subject: "Weekly update",
        text: "summary",
        uid: 10,
      },
    ]);

    const result = await runEmailTool(
      { action: "list", limit: 5 },
      {
        createReader: () => reader,
        loadConfig: async () => completeConfig,
      }
    );

    expect("messages" in result && result.messages).toHaveLength(1);
  });

  test("reads a message by uid", async () => {
    const reader = createFakeMailReader([
      {
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        from: "team@example.com",
        subject: "Details",
        text: "full body",
        uid: 42,
      },
    ]);

    const result = await runEmailTool(
      { action: "read", uid: 42 },
      {
        createReader: () => reader,
        loadConfig: async () => completeConfig,
      }
    );

    expect("message" in result && result.message?.text).toBe("full body");
  });

  test("returns scoped references for message attachments", async () => {
    const reader = createFakeMailReader([
      {
        attachments: [
          {
            disposition: "attachment",
            filename: "report.pdf",
            id: "0",
            mediaType: "application/pdf",
            size: 123,
          },
        ],
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        from: "team@example.com",
        subject: "Report",
        uid: 43,
      },
    ]);

    const result = await runEmailTool(
      { action: "read", uid: 43 },
      {
        createReader: () => reader,
        loadConfig: async () => completeConfig,
      },
      {
        orgId: "org_test",
        profileId: "profile_test",
        sessionId: "session_test",
      }
    );

    expect(
      "message" in result && result.message?.attachments?.[0]
    ).toMatchObject({
      disposition: "attachment",
      filename: "report.pdf",
      mediaType: "application/pdf",
      size: 123,
    });
    expect(
      "message" in result && result.message?.attachments?.[0]?.documentRef
    ).toContain(".");
  });

  test("searches messages", async () => {
    const reader = createFakeMailReader([
      {
        date: "2026-06-21T00:00:00.000Z",
        folder: "INBOX",
        from: "billing@example.com",
        subject: "Invoice",
        text: "due now",
        uid: 1,
      },
    ]);

    const result = await runEmailTool(
      { action: "search", query: "invoice" },
      {
        createReader: () => reader,
        loadConfig: async () => completeConfig,
      }
    );

    expect("messages" in result && result.messages?.[0]?.subject).toBe(
      "Invoice"
    );
  });

  test("sends email with fake sender", async () => {
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      {
        action: "send",
        subject: "Hello",
        text: "Body",
        to: "recipient@example.com",
      },
      {
        createSender: () => sender,
        loadConfig: async () => completeConfig,
      }
    );

    expect("sent" in result && result.sent?.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
  });

  test("rejects invalid recipient", async () => {
    const sender = createFakeMailSender();

    const result = await runEmailTool(
      {
        action: "send",
        subject: "Hello",
        text: "Body",
        to: "not-an-email",
      },
      {
        createSender: () => sender,
        loadConfig: async () => completeConfig,
      }
    );

    expect(result).toEqual({ error: "Invalid recipient email address." });
  });

  test("requires text body for send", async () => {
    await expect(
      runEmailTool(
        {
          action: "send",
          subject: "Hello",
          to: "recipient@example.com",
        },
        {
          createSender: () => createFakeMailSender(),
          loadConfig: async () => completeConfig,
        }
      )
    ).rejects.toThrow("text is required.");
  });

  test("sanitizes sender errors", async () => {
    const result = await runEmailTool(
      {
        action: "send",
        subject: "Hello",
        text: "Body",
        to: "recipient@example.com",
      },
      {
        createSender: () => ({
          async send() {
            throw new Error("SMTP auth failed password=secret-password");
          },
        }),
        loadConfig: async () => completeConfig,
      }
    );

    expect(result).toEqual({ error: "SMTP auth failed password=[REDACTED]" });
  });
});
