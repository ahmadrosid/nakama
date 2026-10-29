import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { EmailConfigFile } from "../email-config";
import { builtinTools } from "./builtin";
import {
  createFakeMailReader,
  createFakeMailSender,
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
  test("builtin tool schemas all declare type object for LLM providers", () => {
    for (const tool of builtinTools) {
      expect(tool.parameters?.type, `${tool.name} parameters.type`).toBe(
        "object"
      );

      const schema = tool.parameters
        ? z.record(z.string(), z.json()).parse(tool.parameters)
        : undefined;

      expect(schema?.oneOf, `${tool.name} oneOf`).toBeUndefined();
      expect(schema?.anyOf, `${tool.name} anyOf`).toBeUndefined();
    }
  });

  test("strips cross-action fields advertised by the flat LLM schema", async () => {
    const sender = createFakeMailSender();

    const input = {
      action: "send",
      folder: "INBOX",
      limit: 20,
      query: "noise",
      subject: "Hello",
      text: "Body",
      to: "recipient@example.com",
      uid: 99,
    } as const;

    const result = await runEmailTool(input, {
      createSender: () => sender,
      loadConfig: async () => completeConfig,
    });

    expect("sent" in result && result.sent?.messageId).toBe("fake-message-id");
    expect(sender.sent).toHaveLength(1);
  });

  test("only org admins, platform admins and automation turns reach the mailbox", async () => {
    const run = (context: Parameters<typeof emailTool.run>[1]) =>
      emailTool.run({ action: "list", limit: 1 }, context);

    const refused = { error: "Only org admins can use the email tool." };

    expect(await run({ orgRole: "member" })).toEqual(refused);
    expect(await run({})).toEqual(refused);

    for (const context of [
      { orgRole: "admin" as const },
      { isPlatformAdmin: true, orgRole: "member" as const },
      { automationId: "automation_1", orgRole: "member" as const },
    ]) {
      expect(await run(context)).not.toEqual(refused);
    }
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
    let senderCreated = false;

    await expect(
      runEmailTool(
        // @ts-expect-error Exercise runtime validation of a send request without its required text field.
        {
          action: "send",
          subject: "Hello",
          to: "recipient@example.com",
        },
        {
          createSender: () => {
            senderCreated = true;

            return createFakeMailSender();
          },
          loadConfig: async () => completeConfig,
        }
      )
    ).rejects.toThrow();

    expect(senderCreated).toBe(false);
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
