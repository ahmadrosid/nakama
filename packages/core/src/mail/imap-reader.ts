import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MailboxConfig } from "./types";
import {
  formatMailAddress,
  truncateMailBody,
  type MailMessage,
  type MailMessageSummary,
  type MailReader,
} from "./types";
import { sanitizeMailError } from "./sanitize";

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
        date: (message.internalDate ?? new Date()).toISOString(),
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
        const uids = await client.search({ all: true }, { uid: true });
        return summariesFromUids(folder, uids, limit);
      } finally {
        lock.release();
      }
    },
    async readMessage(folder, uid) {
      await ensureConnected();
      const lock = await client.getMailboxLock(folder);

      try {
        for await (const message of client.fetch(
          uid,
          { source: true, envelope: true, internalDate: true },
          { uid: true },
        )) {
          const source = message.source;

          if (!source) {
            continue;
          }

          const parsed = await simpleParser(source);
          const textBody = parsed.text?.trim() ?? "";
          const htmlBody = parsed.html?.trim() ?? "";
          const preferred = textBody || htmlBody;
          const truncated = preferred
            ? truncateMailBody(preferred)
            : { text: "", truncated: false };

          return {
            uid: message.uid,
            subject: message.envelope?.subject?.trim() || "(no subject)",
            from: formatMailAddress(message.envelope?.from?.[0]),
            date: (message.internalDate ?? new Date()).toISOString(),
            folder,
            ...(textBody ? { text: truncated.text } : {}),
            ...(!textBody && htmlBody ? { html: truncated.text } : {}),
            ...(truncated.truncated ? { truncated: true } : {}),
          } satisfies MailMessage;
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
        const uids = await client.search(
          {
            or: [{ subject: trimmed }, { from: trimmed }, { body: trimmed }],
          },
          { uid: true },
        );
        return summariesFromUids(folder, uids, limit);
      } finally {
        lock.release();
      }
    },
  };
}

export function mapImapError(err: unknown): Error {
  return new Error(sanitizeMailError(err));
}
