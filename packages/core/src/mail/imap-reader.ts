import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { MAX_DOCUMENT_BYTES } from "../message-content";
import type { MailboxConfig } from "./types";
import {
  formatMailAddress,
  MAX_EMAIL_MESSAGE_BYTES,
  truncateMailBody,
  type MailAttachment,
  type MailMessage,
  type MailMessageSummary,
  type MailReader,
} from "./types";
import { sanitizeMailError } from "./sanitize";

function toIsoDate(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return new Date().toISOString();
}

function asUidList(uids: number[] | false): number[] {
  return uids === false ? [] : uids;
}

function attachmentMetadata(
  attachment: { filename?: string; contentType?: string; size?: number; contentDisposition?: string },
  id: string,
): MailAttachment {
  return {
    id,
    filename: (attachment.filename || "attachment").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255),
    mediaType: attachment.contentType?.toLowerCase() || "application/octet-stream",
    size: attachment.size ?? 0,
    disposition:
      attachment.contentDisposition === "inline"
        ? "inline"
        : attachment.contentDisposition === "attachment"
          ? "attachment"
          : null,
  };
}

export function createImapReader(config: MailboxConfig): MailReader {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
    logger: false,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });

  let connected = false;

  async function ensureConnected(): Promise<void> {
    if (!connected) {
      await client.connect();
      connected = true;
    }
  }

  async function summariesFromUids(
    folder: string,
    uids: number[],
    limit: number,
  ): Promise<MailMessageSummary[]> {
    if (uids.length === 0) {
      return [];
    }

    const selected = uids.slice(-limit);
    const summaries: MailMessageSummary[] = [];

    for await (const message of client.fetch(
      selected,
      { envelope: true, internalDate: true },
      { uid: true },
    )) {
      summaries.push({
        uid: message.uid,
        subject: message.envelope?.subject?.trim() || "(no subject)",
        from: formatMailAddress(message.envelope?.from?.[0]),
        date: toIsoDate(message.internalDate),
        folder,
      });
    }

    return summaries.sort((left, right) => right.uid - left.uid);
  }

  return {
    async connect() {
      await ensureConnected();
    },
    async disconnect() {
      if (connected) {
        await client.logout();
        connected = false;
      }
    },
    async listMessages(folder, limit) {
      await ensureConnected();
      const lock = await client.getMailboxLock(folder);

      try {
        const uids = asUidList(await client.search({ all: true }, { uid: true }));
        return await summariesFromUids(folder, uids, limit);
      } finally {
        lock.release();
      }
    },
    async readMessage(folder, uid) {
      await ensureConnected();
      const lock = await client.getMailboxLock(folder);

      try {
        const overview = await client.fetchOne(uid, { size: true }, { uid: true });
        if (overview && overview.size != null && overview.size > MAX_EMAIL_MESSAGE_BYTES) {
          throw new Error(`Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`);
        }
        for await (const message of client.fetch(
          uid,
          { source: true, envelope: true, internalDate: true },
          { uid: true },
        )) {
          const source = message.source;

          if (!source) {
            continue;
          }
          if (source.length > MAX_EMAIL_MESSAGE_BYTES) {
            throw new Error(`Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`);
          }

          const parsed = await simpleParser(source);
          const textBody = parsed.text?.trim() ?? "";
          const htmlBody =
            typeof parsed.html === "string" ? parsed.html.trim() : "";
          const preferred = textBody || htmlBody;
          const truncated = preferred
            ? truncateMailBody(preferred)
            : { text: "", truncated: false };

          return {
            uid: message.uid,
            subject: message.envelope?.subject?.trim() || "(no subject)",
            from: formatMailAddress(message.envelope?.from?.[0]),
            date: toIsoDate(message.internalDate),
            folder,
            ...(textBody ? { text: truncated.text } : {}),
            ...(!textBody && htmlBody ? { html: truncated.text } : {}),
            ...(truncated.truncated ? { truncated: true } : {}),
            ...(parsed.attachments.length > 0
              ? {
                  attachments: parsed.attachments.map((attachment, index) =>
                    attachmentMetadata(attachment, String(index)),
                  ),
                }
              : {}),
          } satisfies MailMessage;
        }

        return null;
      } finally {
        lock.release();
      }
    },
    async readAttachment(folder, uid, attachmentId) {
      await ensureConnected();
      const lock = await client.getMailboxLock(folder);

      try {
        const overview = await client.fetchOne(uid, { size: true }, { uid: true });
        if (overview && overview.size != null && overview.size > MAX_EMAIL_MESSAGE_BYTES) {
          throw new Error(`Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`);
        }
        for await (const message of client.fetch(
          uid,
          { source: true },
          { uid: true },
        )) {
          if (!message.source || message.source.length > MAX_EMAIL_MESSAGE_BYTES) {
            throw new Error(`Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`);
          }
          const parsed = await simpleParser(message.source);
          const index = Number.parseInt(attachmentId, 10);
          const attachment = Number.isInteger(index) ? parsed.attachments[index] : undefined;
          if (!attachment) {
            return null;
          }

          const metadata = attachmentMetadata(attachment, attachmentId);
          if (metadata.size > MAX_DOCUMENT_BYTES) {
            throw new Error(`Email attachment exceeds ${MAX_DOCUMENT_BYTES} bytes.`);
          }
          if (attachment.content.length > MAX_DOCUMENT_BYTES) {
            throw new Error(`Email attachment exceeds ${MAX_DOCUMENT_BYTES} bytes.`);
          }
          return { metadata, data: attachment.content };
        }

        return null;
      } finally {
        lock.release();
      }
    },
    async searchMessages(folder, query, limit) {
      await ensureConnected();
      const trimmed = query.trim();

      if (!trimmed) {
        return [];
      }

      const lock = await client.getMailboxLock(folder);

      try {
        const uids = asUidList(
          await client.search(
            {
              or: [{ subject: trimmed }, { from: trimmed }, { body: trimmed }],
            },
            { uid: true },
          ),
        );
        return await summariesFromUids(folder, uids, limit);
      } finally {
        lock.release();
      }
    },
  };
}

export function mapImapError(err: unknown): Error {
  return new Error(sanitizeMailError(err));
}
