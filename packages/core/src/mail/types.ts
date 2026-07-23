import type { EmailConfigFile } from "../email-config";
import { toMailboxConfig } from "../email-config";

export const MAX_EMAIL_BODY_BYTES = 256 * 1024;

export interface MailMessageSummary {
  uid: number;
  subject: string;
  from: string;
  date: string;
  folder: string;
}

export interface MailMessage extends MailMessageSummary {
  text?: string;
  html?: string;
  truncated?: boolean;
}

export interface MailSendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailSendResult {
  messageId: string;
}

export interface MailReader {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listMessages(folder: string, limit: number): Promise<MailMessageSummary[]>;
  readMessage(folder: string, uid: number): Promise<MailMessage | null>;
  searchMessages(
    folder: string,
    query: string,
    limit: number,
  ): Promise<MailMessageSummary[]>;
}

export interface MailSender {
  send(input: MailSendInput): Promise<MailSendResult>;
}

export type MailboxConfig = ReturnType<typeof toMailboxConfig>;

export function emailConfigToMailboxConfig(config: EmailConfigFile): MailboxConfig {
  return toMailboxConfig(config);
}

export function formatMailAddress(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "address" in value &&
    typeof (value as { address?: unknown }).address === "string"
  ) {
    const entry = value as { name?: string; address: string };
    const name = entry.name?.trim();
    return name ? `${name} <${entry.address}>` : entry.address;
  }

  return "";
}

export function truncateMailBody(value: string, maxBytes = MAX_EMAIL_BODY_BYTES): {
  text: string;
  truncated: boolean;
} {
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
