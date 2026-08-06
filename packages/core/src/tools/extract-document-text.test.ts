import { describe, expect, test } from "bun:test";
import {
  emailConfigToMailboxConfig,
  type EmailConfigFile,
} from "../email-config";
import type { MailReader } from "../mail/types";
import {
  createAttachmentReference,
  getMailboxIdentity,
} from "../mail/attachment-reference";
import { runExtractDocumentText } from "./extract-document-text";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??= "test-email-attachment-secret-32-chars";

const completeConfig: EmailConfigFile = {
  imapHost: "imap.example.com",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  username: "user@example.com",
  password: "secret-password",
  from: "user@example.com",
  fromName: "",
};

const context = {
  orgId: "org_test",
  profileId: "profile_test",
  sessionId: "session_test",
};
const mailboxId = getMailboxIdentity(emailConfigToMailboxConfig(completeConfig));

function readerWith(data: Buffer): MailReader {
  return {
    async connect() {},
    async disconnect() {},
    async listMessages() {
      return [];
    },
    async readMessage() {
      return null;
    },
    async readAttachment() {
      return {
        metadata: {
          id: "0",
          filename: "report.pdf",
          mediaType: "application/pdf",
          size: data.length,
          disposition: "attachment",
        },
        data,
      };
    },
    async searchMessages() {
      return [];
    },
  };
}

function textPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 35} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "binary"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "binary");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

describe("extract_document_text tool", () => {
  test("extracts text from a valid PDF attachment", async () => {
    const documentRef = createAttachmentReference(context, {
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
      mailboxId,
    });

    const result = await runExtractDocumentText(
      { documentRef },
      context,
      {
        loadConfig: async () => completeConfig,
        createReader: () => readerWith(textPdf("Hello PDF")),
      },
    );

    expect(result).toMatchObject({
      filename: "report.pdf",
      mediaType: "application/pdf",
      truncated: false,
      untrustedContent: true,
    });
    expect("text" in result && result.text).toContain("Hello PDF");
  });

  test("extracts from a provider-neutral stored document reference", async () => {
    const result = await runExtractDocumentText(
      { documentRef: "att_provider_document" },
      {
        ...context,
        loadAttachment: async (attachmentId) =>
          attachmentId === "att_provider_document"
            ? {
                bytes: textPdf("Provider document"),
                mediaType: "application/pdf",
                filename: "provider.pdf",
              }
            : null,
      },
      { loadConfig: async () => ({}) as typeof completeConfig },
    );

    expect(result).toMatchObject({
      filename: "provider.pdf",
      mediaType: "application/pdf",
      untrustedContent: true,
    });
    expect("text" in result && result.text).toContain("Provider document");
  });

  test("rejects invalid PDF bytes", async () => {
    const documentRef = createAttachmentReference(context, {
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
      mailboxId,
    });

    const result = await runExtractDocumentText(
      { documentRef },
      context,
      {
        loadConfig: async () => completeConfig,
        createReader: () => readerWith(Buffer.from("not a pdf")),
      },
    );

    expect(result).toEqual({ error: "The selected document is not a valid PDF." });
  });

  test("rejects a reference from another session", async () => {
    const documentRef = createAttachmentReference(context, {
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
      mailboxId,
    });

    const result = await runExtractDocumentText(
      { documentRef },
      { ...context, sessionId: "other" },
      {
        loadConfig: async () => completeConfig,
        createReader: () => readerWith(Buffer.from("not a pdf")),
      },
    );

    expect(result).toEqual({ error: "Email attachment reference expired or out of scope." });
  });
});
