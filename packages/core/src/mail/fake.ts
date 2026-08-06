import type {
  MailMessage,
  MailMessageSummary,
  MailReader,
  MailSendInput,
  MailSender,
} from "./types";

type FakeMailMessage = MailMessage & {
  attachmentData?: Record<string, Buffer>;
};

export function createFakeMailReader(messages: FakeMailMessage[] = []): MailReader & {
  messages: FakeMailMessage[];
} {
  const store = [...messages];

  return {
    messages: store,
    async connect() {},
    async disconnect() {},
    async listMessages(folder, limit) {
      return store
        .filter((message) => message.folder === folder)
        .slice(0, limit)
        .map(toSummary);
    },
    async readMessage(folder, uid) {
      const message = store.find((entry) => entry.folder === folder && entry.uid === uid);
      return message ? { ...message } : null;
    },
    async readAttachment(folder, uid, attachmentId) {
      const message = store.find((entry) => entry.folder === folder && entry.uid === uid);
      const attachment = message?.attachments?.find((entry) => entry.id === attachmentId);
      if (!attachment) {
        return null;
      }

      return {
        metadata: attachment,
        data: message?.attachmentData?.[attachmentId] ?? Buffer.alloc(attachment.size),
      };
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
    sent,
    async send(input) {
      sent.push(input);
      return { messageId: "fake-message-id" };
    },
  };
}

function toSummary(message: MailMessage): MailMessageSummary {
  return {
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    date: message.date,
    folder: message.folder,
  };
}
