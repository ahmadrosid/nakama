import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EmailConfigFile,
  emailConfigToMailboxConfig,
} from "../email-config";
import {
  createAttachmentReference,
  getMailboxIdentity,
} from "../mail/attachment-reference";
import type { MailReader } from "../mail/types";
import { runExtractDocumentText } from "./extract-document-text";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??=
  "test-email-attachment-secret-32-chars";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");
const SAMPLE_PDF = readFileSync(join(FIXTURES, "sample.pdf"));
const SAMPLE_DOCX = readFileSync(join(FIXTURES, "sample.docx"));
const SAMPLE_XLSX = readFileSync(join(FIXTURES, "sample.xlsx"));

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

const context = {
  orgId: "org_test",
  profileId: "profile_test",
  sessionId: "session_test",
};
const mailboxId = getMailboxIdentity(
  emailConfigToMailboxConfig(completeConfig)
);

function readerWith(
  data: Buffer,
  options?: { filename?: string; mediaType?: string }
): MailReader {
  return {
    async connect() {},
    async disconnect() {},
    async listMessages() {
      return [];
    },
    async readAttachment() {
      return {
        data,
        metadata: {
          disposition: "attachment",
          filename: options?.filename ?? "report.pdf",
          id: "0",
          mediaType: options?.mediaType ?? "application/pdf",
          size: data.length,
        },
      };
    },
    async readMessage() {
      return null;
    },
    async searchMessages() {
      return [];
    },
  };
}

describe("extract_document_text tool", () => {
  test("extracts text from a valid PDF attachment", async () => {
    const documentRef = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId,
      uid: 42,
    });

    const result = await runExtractDocumentText({ documentRef }, context, {
      createReader: () => readerWith(SAMPLE_PDF),
      loadConfig: async () => completeConfig,
    });

    expect(result).toMatchObject({
      filename: "report.pdf",
      mediaType: "application/pdf",
      truncated: false,
      untrustedContent: true,
    });
    expect("text" in result && result.text.toLowerCase()).toContain("dummy");
  });

  test("extracts text from a DOCX attachment", async () => {
    const documentRef = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId,
      uid: 42,
    });

    const result = await runExtractDocumentText({ documentRef }, context, {
      createReader: () =>
        readerWith(SAMPLE_DOCX, {
          filename: "notes.docx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      loadConfig: async () => completeConfig,
    });

    expect(result).toMatchObject({
      filename: "notes.docx",
      untrustedContent: true,
    });
    expect("text" in result && result.text).toContain("Laporan");
  });

  test("extracts text from an Excel attachment", async () => {
    const documentRef = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId,
      uid: 42,
    });

    const result = await runExtractDocumentText({ documentRef }, context, {
      createReader: () =>
        readerWith(SAMPLE_XLSX, {
          filename: "budget.xlsx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      loadConfig: async () => completeConfig,
    });

    expect(result).toMatchObject({
      filename: "budget.xlsx",
      untrustedContent: true,
    });
    expect("text" in result && result.text).toContain("Widget");
  });

  test("extracts from a provider-neutral stored document reference", async () => {
    const result = await runExtractDocumentText(
      { documentRef: "att_provider_document" },
      {
        ...context,
        loadAttachment: async (attachmentId) =>
          attachmentId === "att_provider_document"
            ? {
                bytes: SAMPLE_PDF,
                filename: "provider.pdf",
                mediaType: "application/pdf",
              }
            : null,
      },
      { loadConfig: async () => ({}) as typeof completeConfig }
    );

    expect(result).toMatchObject({
      filename: "provider.pdf",
      mediaType: "application/pdf",
      untrustedContent: true,
    });
    expect("text" in result && result.text.toLowerCase()).toContain("dummy");
  });

  test("rejects unsupported document bytes", async () => {
    const documentRef = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId,
      uid: 42,
    });

    const result = await runExtractDocumentText({ documentRef }, context, {
      createReader: () =>
        readerWith(Buffer.from("not a document"), {
          filename: "notes.bin",
          mediaType: "application/octet-stream",
        }),
      loadConfig: async () => completeConfig,
    });

    expect(result).toEqual({
      error:
        "The selected document is not a supported PDF, Word, or Excel file.",
    });
  });

  test("rejects a reference from another session", async () => {
    const documentRef = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId,
      uid: 42,
    });

    const result = await runExtractDocumentText(
      { documentRef },
      { ...context, sessionId: "other" },
      {
        createReader: () => readerWith(Buffer.from("not a pdf")),
        loadConfig: async () => completeConfig,
      }
    );

    expect(result).toEqual({
      error: "Email attachment reference expired or out of scope.",
    });
  });
});
