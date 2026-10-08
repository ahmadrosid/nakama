import { z } from "zod";
import type { toMailboxConfig } from "../email-config";

const MailAddressSchema = z.union([
  z.string(),
  z.object({ address: z.string().optional(), name: z.string().optional() }),
]);

export type MailAddressInput =
  | string
  | { address?: string; name?: string }
  | null
  | undefined;

export const MAX_EMAIL_BODY_BYTES = 256 * 1024;

export const MAX_EMAIL_MESSAGE_BYTES = 10 * 1024 * 1024;

export interface MailAttachment {
  disposition: "attachment" | "inline" | null;
  filename: string;
  id: string;
  mediaType: string;
  size: number;
}

export interface MailMessageSummary {
  date: string;
  folder: string;
  from: string;
  subject: string;
  uid: number;
}

export interface MailMessage extends MailMessageSummary {
  attachments?: MailAttachment[];
  html?: string;
  text?: string;
  truncated?: boolean;
}

export interface MailSendInput {
  html?: string;
  subject: string;
  text: string;
  to: string;
}

export interface MailSendResult {
  messageId: string;
}

export interface MailReader {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listMessages(folder: string, limit: number): Promise<MailMessageSummary[]>;
  readAttachment(
    folder: string,
    uid: number,
    attachmentId: string
  ): Promise<{ metadata: MailAttachment; data: Buffer } | null>;
  readMessage(folder: string, uid: number): Promise<MailMessage | null>;
  searchMessages(
    folder: string,
    query: string,
    limit: number
  ): Promise<MailMessageSummary[]>;
}

export interface MailSender {
  send(input: MailSendInput): Promise<MailSendResult>;
}

export type MailboxConfig = ReturnType<typeof toMailboxConfig>;

export interface MailBodyPreview {
  text: string;
  truncated: boolean;
}

export function formatMailAddress(value: MailAddressInput): string {
  if (value == null) {
    return "";
  }

  const parsed = MailAddressSchema.safeParse(value);

  if (!parsed.success) {
    return "";
  }

  const text = z.string().safeParse(parsed.data);

  if (text.success) {
    return text.data.trim();
  }

  const entry = z
    .object({ address: z.string().optional(), name: z.string().optional() })
    .passthrough()
    .safeParse(parsed.data);

  if (!entry.success) {
    return "";
  }

  if (!entry.data.address) {
    return "";
  }

  const name = entry.data.name?.trim();

  return name ? `${name} <${entry.data.address}>` : entry.data.address;
}

export function truncateMailBody(
  value: string,
  maxBytes = MAX_EMAIL_BODY_BYTES
): MailBodyPreview {
  const bytes = Buffer.byteLength(value, "utf8");

  if (bytes <= maxBytes) {
    return { text: value, truncated: false };
  }

  let end = value.length;

  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }

  return {
    text: `${value.slice(0, end)}…`,
    truncated: true,
  };
}
