import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { MAX_DOCUMENT_BYTES } from "../message-content";
import type { MailboxConfig } from "./types";
import {
  formatMailAddress,
  MAX_EMAIL_MESSAGE_BYTES,
  type MailAttachment,
  type MailMessage,
  type MailMessageSummary,
  type MailReader,
  truncateMailBody,
} from "./types";

function toIsoDate(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value?.trim()) {
    return value;
  }

  return new Date().toISOString();
}

// imapflow 2.x resolves search() to undefined as well as false when the command
// returns nothing usable. Both mean no uids, so both collapse to an empty list
// here rather than at each call site.
function asUidList(uids: number[] | false | undefined): number[] {
  return uids || [];
}

function attachmentMetadata(
  attachment: {
    filename?: string;
    contentType?: string;
    size?: number;
    contentDisposition?: string;
  },
  id: string
): MailAttachment {
  return {
    disposition:
      attachment.contentDisposition === "inline"
        ? "inline"
        : attachment.contentDisposition === "attachment"
          ? "attachment"
          : null,
    filename: (attachment.filename || "attachment")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 255),
    id,
    mediaType:
      attachment.contentType?.toLowerCase() || "application/octet-stream",
    size: attachment.size ?? 0,
  };
}

export function createImapReader(config: MailboxConfig): MailReader {
  const client = new ImapFlow({
    auth: {
      pass: config.auth.pass,
      user: config.auth.user,
    },
    host: config.imap.host,
    logger: false,
    port: config.imap.port,
    secure: config.imap.secure,
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
    limit: number
  ): Promise<MailMessageSummary[]> {
    if (uids.length === 0) {
      return [];
    }

    const selected = uids.slice(-limit);
    const summaries: MailMessageSummary[] = [];

    for await (const message of client.fetch(
      selected,
      { envelope: true, internalDate: true },
      { uid: true }
    )) {
      summaries.push({
        date: toIsoDate(message.internalDate),
        folder,
        from: formatMailAddress(message.envelope?.from?.[0]),
        subject: message.envelope?.subject?.trim() || "(no subject)",
        uid: message.uid,
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
        const uids = asUidList(
          await client.search({ all: true }, { uid: true })
        );

        return await summariesFromUids(folder, uids, limit);
      } finally {
        lock.release();
      }
    },
    async readAttachment(folder, uid, attachmentId) {
      await ensureConnected();
      const lock = await client.getMailboxLock(folder);

      try {
        const overview = await client.fetchOne(
          uid,
          { size: true },
          { uid: true }
        );

        if (
          overview &&
          overview.size != null &&
          overview.size > MAX_EMAIL_MESSAGE_BYTES
        ) {
          throw new Error(
            `Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`
          );
        }

        for await (const message of client.fetch(
          uid,
          { source: true },
          { uid: true }
        )) {
          if (
            !message.source ||
            message.source.length > MAX_EMAIL_MESSAGE_BYTES
          ) {
            throw new Error(
              `Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`
            );
          }

          const parsed = await simpleParser(message.source);
          const index = Number.parseInt(attachmentId, 10);

          const attachment = Number.isInteger(index)
            ? parsed.attachments[index]
            : undefined;

          if (!attachment) {
            return null;
          }

          const metadata = attachmentMetadata(attachment, attachmentId);

          if (metadata.size > MAX_DOCUMENT_BYTES) {
            throw new Error(
              `Email attachment exceeds ${MAX_DOCUMENT_BYTES} bytes.`
            );
          }

          if (attachment.content.length > MAX_DOCUMENT_BYTES) {
            throw new Error(
              `Email attachment exceeds ${MAX_DOCUMENT_BYTES} bytes.`
            );
          }

          return { data: attachment.content, metadata };
        }

        return null;
      } finally {
        lock.release();
      }
    },
    async readMessage(folder, uid) {
      await ensureConnected();
      const lock = await client.getMailboxLock(folder);

      try {
        const overview = await client.fetchOne(
          uid,
          { size: true },
          { uid: true }
        );

        if (
          overview &&
          overview.size != null &&
          overview.size > MAX_EMAIL_MESSAGE_BYTES
        ) {
          throw new Error(
            `Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`
          );
        }

        for await (const message of client.fetch(
          uid,
          { envelope: true, internalDate: true, source: true },
          { uid: true }
        )) {
          const source = message.source;

          if (!source) {
            continue;
          }

          if (source.length > MAX_EMAIL_MESSAGE_BYTES) {
            throw new Error(
              `Email message exceeds ${MAX_EMAIL_MESSAGE_BYTES} bytes.`
            );
          }

          const parsed = await simpleParser(source);
          const textBody = parsed.text?.trim() ?? "";

          const htmlBody = parsed.html?.trim() || "";

          const preferred = textBody || htmlBody;

          const truncated = preferred
            ? truncateMailBody(preferred)
            : { text: "", truncated: false };

          const result: MailMessage = {
            date: toIsoDate(message.internalDate),
            folder,
            from: formatMailAddress(message.envelope?.from?.[0]),
            subject: message.envelope?.subject?.trim() || "(no subject)",
            uid: message.uid,
          };

          if (textBody) {
            result.text = truncated.text;
          } else if (htmlBody) {
            result.html = truncated.text;
          }

          if (truncated.truncated) {
            result.truncated = true;
          }

          if (parsed.attachments.length > 0) {
            result.attachments = parsed.attachments.map((attachment, index) =>
              attachmentMetadata(attachment, String(index))
            );
          }

          return result;
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
            { uid: true }
          )
        );

        return await summariesFromUids(folder, uids, limit);
      } finally {
        lock.release();
      }
    },
  };
}
