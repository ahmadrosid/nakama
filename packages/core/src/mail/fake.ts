import type {
  MailMessage,
  MailMessageSummary,
  MailReader,
  MailSender,
  MailSendInput,
} from "./types";

type FakeMailMessage = MailMessage & {
  attachmentData?: Record<string, Buffer>;
};

export function createFakeMailReader(
  messages: FakeMailMessage[] = []
): MailReader & {
  messages: FakeMailMessage[];
} {
  const store = [...messages];

  return {
    async connect() {},
    async disconnect() {},
    async listMessages(folder, limit) {
      return store
        .filter((message) => message.folder === folder)
        .slice(0, limit)
        .map(toSummary);
    },
    messages: store,
    async readAttachment(folder, uid, attachmentId) {
      const message = store.find(
        (entry) => entry.folder === folder && entry.uid === uid
      );
      const attachment = message?.attachments?.find(
        (entry) => entry.id === attachmentId
      );
      if (!attachment) {
        return null;
      }

      return {
        data:
          message?.attachmentData?.[attachmentId] ??
          Buffer.alloc(attachment.size),
        metadata: attachment,
      };
    },
    async readMessage(folder, uid) {
      const message = store.find(
        (entry) => entry.folder === folder && entry.uid === uid
      );
      return message ? { ...message } : null;
    },
    async searchMessages(folder, query, limit) {
      const needle = query.trim().toLowerCase();

      return store
        .filter((message) => {
          if (message.folder !== folder) {
            return false;
          }

          return (
            message.subject.toLowerCase().includes(needle) ||
            message.from.toLowerCase().includes(needle) ||
            (message.text?.toLowerCase().includes(needle) ?? false)
          );
        })
        .slice(0, limit)
        .map(toSummary);
    },
  };
}

export function createFakeMailSender(): MailSender & {
  sent: MailSendInput[];
} {
  const sent: MailSendInput[] = [];

  return {
    async send(input) {
      sent.push(input);
      return { messageId: "fake-message-id" };
    },
    sent,
  };
}

function toSummary(message: MailMessage): MailMessageSummary {
  return {
    date: message.date,
    folder: message.folder,
    from: message.from,
    subject: message.subject,
    uid: message.uid,
  };
}
