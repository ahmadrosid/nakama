import { z } from "zod";
import type { JsonSchema, ToolContext, ToolDefinition } from "../contract";
import {
  emailConfigToMailboxConfig,
  isEmailConfigComplete,
  loadEmailConfig,
} from "../email-config";
import {
  createAttachmentReference,
  getMailboxIdentity,
} from "../mail/attachment-reference";
import { createFakeMailReader, createFakeMailSender } from "../mail/fake";
import { createImapReader } from "../mail/imap-reader";
import { sanitizeMailError } from "../mail/sanitize";
import { createSmtpSender } from "../mail/smtp-sender";
import type { MailMessage, MailReader, MailSender } from "../mail/types";
import { MAX_EMAIL_BODY_BYTES } from "../mail/types";
import { parseToolInput } from "./schema";

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const folderSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.string().optional().default("INBOX")
);

const limitSchema = z.preprocess((value) => {
  if (value === undefined) {
    return 20;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return 20;
  }
  return Math.min(value, 100);
}, z.number().int().positive().max(100));

const emailListInputSchema = z.object({
  action: z.literal("list"),
  folder: folderSchema,
  limit: limitSchema,
});

const emailReadInputSchema = z.object({
  action: z.literal("read"),
  folder: folderSchema,
  uid: z
    .number({ error: "uid is required." })
    .int()
    .positive({ error: "uid must be a positive integer." }),
});

const emailSearchInputSchema = z.object({
  action: z.literal("search"),
  folder: folderSchema,
  limit: limitSchema,
  query: z.string({ error: "query is required." }).trim().min(1),
});

const emailSendInputSchema = z.object({
  action: z.literal("send"),
  html: z.string().trim().min(1).optional(),
  subject: z.string({ error: "subject is required." }).trim().min(1),
  text: z.string({ error: "text is required." }).trim().min(1),
  to: z.string({ error: "to is required." }).trim().min(1),
});

export const emailInputSchema = z.discriminatedUnion("action", [
  emailListInputSchema,
  emailReadInputSchema,
  emailSearchInputSchema,
  emailSendInputSchema,
]);

export type EmailAction = z.infer<typeof emailInputSchema>["action"];
export type EmailToolInput = z.infer<typeof emailInputSchema>;

/**
 * OpenAI (and several OpenAI-compatible providers) require tool `parameters`
 * to be a JSON Schema with top-level `type: "object"`. Zod's discriminated
 * union emits `oneOf`/`anyOf` without that key, which providers reject with
 * 400 invalid_function_parameters — blocking all chat when email is enabled.
 * Keep `emailInputSchema` for runtime parsing; expose a flat object schema to LLMs.
 */
export function emailParameters(): JsonSchema {
  return {
    additionalProperties: false,
    properties: {
      action: {
        enum: ["list", "read", "search", "send"],
        type: "string",
      },
      folder: {
        description: "Mail folder. Defaults to INBOX.",
        type: "string",
      },
      html: {
        description: "Optional HTML body for action=send.",
        type: "string",
      },
      limit: {
        description: "Max messages to return (1-100). Defaults to 20.",
        type: "integer",
      },
      query: {
        description: "Search query. Required for action=search.",
        type: "string",
      },
      subject: {
        description: "Subject. Required for action=send.",
        type: "string",
      },
      text: {
        description: "Plain-text body. Required for action=send.",
        type: "string",
      },
      to: {
        description: "Recipient address. Required for action=send.",
        type: "string",
      },
      uid: {
        description: "Message UID. Required for action=read.",
        type: "integer",
      },
    },
    required: ["action"],
    type: "object",
  };
}

export interface EmailToolSuccess {
  action: EmailAction;
  message?: {
    uid: number;
    subject: string;
    from: string;
    date: string;
    folder: string;
    text?: string;
    html?: string;
    truncated?: boolean;
    attachments?: Array<{
      documentRef: string;
      filename: string;
      mediaType: string;
      size: number;
      disposition: "attachment" | "inline" | null;
    }>;
  };
  messages?: Array<{
    uid: number;
    subject: string;
    from: string;
    date: string;
    folder: string;
  }>;
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
  createReader?: (
    config: ReturnType<typeof emailConfigToMailboxConfig>
  ) => MailReader;
  createSender?: (
    config: ReturnType<typeof emailConfigToMailboxConfig>
  ) => MailSender;
  loadConfig?: typeof loadEmailConfig;
}

function parseEmailToolInput(input: unknown): EmailToolInput {
  return parseToolInput(emailInputSchema, input);
}

export async function runEmailTool(
  input: unknown,
  dependencies: EmailToolDependencies = {},
  context: ToolContext = {}
): Promise<EmailToolResult> {
  const loadConfig = dependencies.loadConfig ?? loadEmailConfig;
  const config = await loadConfig();

  if (!isEmailConfigComplete(config)) {
    return {
      error:
        "Email is not configured. Ask an org admin to set up mailbox settings in System → Tools.",
    };
  }

  const parsed = parseEmailToolInput(input);
  const mailboxConfig = emailConfigToMailboxConfig(config);

  if (parsed.action === "send") {
    return sendEmail(parsed, mailboxConfig, dependencies.createSender);
  }

  const readerFactory = dependencies.createReader ?? createImapReader;
  const reader = readerFactory(mailboxConfig);

  try {
    await reader.connect();

    if (parsed.action === "list") {
      const messages = await reader.listMessages(parsed.folder, parsed.limit);
      return { action: parsed.action, messages };
    }

    if (parsed.action === "read") {
      const message = await reader.readMessage(parsed.folder, parsed.uid);

      if (!message) {
        return {
          error: `No message found with uid ${parsed.uid} in ${parsed.folder}.`,
        };
      }

      return {
        action: parsed.action,
        message: toEmailMessage(
          message,
          context,
          getMailboxIdentity(mailboxConfig)
        ),
      };
    }

    const messages = await reader.searchMessages(
      parsed.folder,
      parsed.query,
      parsed.limit
    );
    return { action: parsed.action, messages };
  } catch (err) {
    return { error: sanitizeMailError(err) };
  } finally {
    await reader.disconnect().catch(() => undefined);
  }
}

async function sendEmail(
  input: Extract<EmailToolInput, { action: "send" }>,
  mailboxConfig: ReturnType<typeof emailConfigToMailboxConfig>,
  createSender: EmailToolDependencies["createSender"]
): Promise<EmailToolResult> {
  const { to, subject, text, html } = input;

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
    const result = await sender.send({ html, subject, text, to });
    return {
      action: "send",
      sent: {
        messageId: result.messageId,
        subject,
        to,
      },
    };
  } catch (err) {
    return { error: sanitizeMailError(err) };
  }
}

export const emailTool: ToolDefinition<EmailToolInput, EmailToolResult> = {
  description:
    "List, read, search, and send email through the deployment mailbox configured in Settings. Read exposes documentRef values for supported document attachments; pass one to extract_document_text when you need document text.",
  name: "email",
  parameters: emailParameters(),
  run(input, context) {
    return runEmailTool(input, {}, context);
  },
};

function toEmailMessage(
  message: MailMessage,
  context: ToolContext,
  mailboxId: string
): NonNullable<Extract<EmailToolSuccess, { message?: unknown }>["message"]> {
  const { attachments, ...messageWithoutAttachments } = message;
  if (!attachments) {
    return messageWithoutAttachments;
  }

  return {
    ...messageWithoutAttachments,
    attachments: attachments.map((attachment) => ({
      disposition: attachment.disposition,
      documentRef: createAttachmentReference(context, {
        attachmentId: attachment.id,
        folder: message.folder,
        mailboxId,
        uid: message.uid,
      }),
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      size: attachment.size,
    })),
  };
}

export { createFakeMailReader, createFakeMailSender };
