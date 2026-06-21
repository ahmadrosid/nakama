import type { ToolDefinition } from "../contract";
import {
  emailConfigToMailboxConfig,
  isEmailConfigComplete,
  loadEmailConfig,
} from "../email-config";
import { createFakeMailReader, createFakeMailSender } from "../mail/fake";
import { createImapReader } from "../mail/imap-reader";
import { createSmtpSender } from "../mail/smtp-sender";
import { sanitizeMailError } from "../mail/sanitize";
import type { MailReader, MailSender } from "../mail/types";
import { MAX_EMAIL_BODY_BYTES } from "../mail/types";

export type EmailAction = "list" | "read" | "search" | "send";

export interface EmailToolInput {
  action: EmailAction;
  folder?: string;
  limit?: number;
  uid?: number;
  query?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export interface EmailToolSuccess {
  action: EmailAction;
  messages?: Array<{
    uid: number;
    subject: string;
    from: string;
    date: string;
    folder: string;
  }>;
  message?: {
    uid: number;
    subject: string;
    from: string;
    date: string;
    folder: string;
    text?: string;
    html?: string;
    truncated?: boolean;
  };
  sent?: {
    to: string;
    subject: string;
    messageId: string;
  };
}

export interface EmailToolFailure {
  error: string;
}

export type EmailToolResult = EmailToolSuccess | EmailToolFailure;

export interface EmailToolDependencies {
  loadConfig?: typeof loadEmailConfig;
  createReader?: (config: ReturnType<typeof emailConfigToMailboxConfig>) => MailReader;
  createSender?: (config: ReturnType<typeof emailConfigToMailboxConfig>) => MailSender;
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function runEmailTool(
  input: unknown,
  dependencies: EmailToolDependencies = {},
): Promise<EmailToolResult> {
  const loadConfig = dependencies.loadConfig ?? loadEmailConfig;
  const config = await loadConfig();

  if (!isEmailConfigComplete(config)) {
    return {
      error:
        "Email is not configured. Ask an org admin to set up mailbox settings in System → Tools.",
    };
  }

  const action = readRequiredString(input, "action") as EmailAction;

  if (!["list", "read", "search", "send"].includes(action)) {
    return { error: `Unsupported email action: ${action}` };
  }

  const mailboxConfig = emailConfigToMailboxConfig(config!);

  if (action === "send") {
    return sendEmail(input, mailboxConfig, dependencies.createSender);
  }

  const readerFactory = dependencies.createReader ?? createImapReader;
  const reader = readerFactory(mailboxConfig);

  try {
    await reader.connect();

    if (action === "list") {
      const folder = readOptionalString(input, "folder") ?? "INBOX";
      const limit = readLimit(input);
      const messages = await reader.listMessages(folder, limit);
      return { action, messages };
    }

    if (action === "read") {
      const folder = readOptionalString(input, "folder") ?? "INBOX";
      const uid = readRequiredNumber(input, "uid");
      const message = await reader.readMessage(folder, uid);

      if (!message) {
        return { error: `No message found with uid ${uid} in ${folder}.` };
      }

      return { action, message };
    }

    const folder = readOptionalString(input, "folder") ?? "INBOX";
    const query = readRequiredString(input, "query");
    const limit = readLimit(input);
    const messages = await reader.searchMessages(folder, query, limit);
    return { action, messages };
  } catch (err) {
    return { error: sanitizeMailError(err) };
  } finally {
    await reader.disconnect().catch(() => undefined);
  }
}

async function sendEmail(
  input: unknown,
  mailboxConfig: ReturnType<typeof emailConfigToMailboxConfig>,
  createSender: EmailToolDependencies["createSender"],
): Promise<EmailToolResult> {
  const to = readRequiredString(input, "to");
  const subject = readRequiredString(input, "subject");
  const text = readRequiredString(input, "text");
  const html = readOptionalString(input, "html") ?? undefined;

  if (!EMAIL_ADDRESS_PATTERN.test(to)) {
    return { error: "Invalid recipient email address." };
  }

  if (to.includes(",")) {
    return { error: "Only one recipient is supported in v1." };
  }

  if (Buffer.byteLength(text, "utf8") > MAX_EMAIL_BODY_BYTES) {
    return { error: `Email body exceeds ${MAX_EMAIL_BODY_BYTES} bytes.` };
  }

  if (html && Buffer.byteLength(html, "utf8") > MAX_EMAIL_BODY_BYTES) {
    return { error: `Email HTML body exceeds ${MAX_EMAIL_BODY_BYTES} bytes.` };
  }

  const senderFactory = createSender ?? createSmtpSender;
  const sender = senderFactory(mailboxConfig);

  try {
    const result = await sender.send({ to, subject, text, html });
    return {
      action: "send",
      sent: {
        to,
        subject,
        messageId: result.messageId,
      },
    };
  } catch (err) {
    return { error: sanitizeMailError(err) };
  }
}

export const emailTool: ToolDefinition<EmailToolInput, EmailToolResult> = {
  name: "email",
  description:
    "List, read, search, and send email through the deployment mailbox configured in Settings. Use list/search to find messages, read to fetch one message body, and send for outbound mail.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "read", "search", "send"],
        description: "Email operation to perform.",
      },
      folder: {
        type: "string",
        description: "Mailbox folder to use. Defaults to INBOX.",
      },
      limit: {
        type: "number",
        description: "Maximum number of messages to return for list/search.",
      },
      uid: {
        type: "number",
        description: "IMAP UID for read.",
      },
      query: {
        type: "string",
        description: "Search query for subject/from/body contains.",
      },
      to: {
        type: "string",
        description: "Recipient email address for send.",
      },
      subject: {
        type: "string",
        description: "Email subject for send.",
      },
      text: {
        type: "string",
        description: "Plain text body for send.",
      },
      html: {
        type: "string",
        description: "Optional HTML body for send.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  run(input) {
    return runEmailTool(input);
  },
};

function readRequiredString(input: unknown, key: string): string {
  const value = readOptionalString(input, key);

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function readOptionalString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRequiredNumber(input: unknown, key: string): number {
  if (typeof input !== "object" || input === null || !(key in input)) {
    throw new Error(`${key} is required.`);
  }

  const value = (input as Record<string, unknown>)[key];

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return value;
}

function readLimit(input: unknown): number {
  if (typeof input !== "object" || input === null || !("limit" in input)) {
    return 20;
  }

  const value = (input as Record<string, unknown>).limit;

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return 20;
  }

  return Math.min(value, 100);
}

export { createFakeMailReader, createFakeMailSender };
