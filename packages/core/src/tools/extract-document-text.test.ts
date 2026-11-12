import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_DOC_UNSUPPORTED_MESSAGE } from "../artifact-mime";
import { type EmailConfigFile, toMailboxConfig } from "../email-config";
import {
  createAttachmentReference,
  getMailboxIdentity,
} from "../mail/attachment-reference";
import { MAX_EMAIL_BODY_BYTES, type MailReader } from "../mail/types";
import {
  runExtractDocumentText,
  UNTRUSTED_DOCUMENT_GUIDANCE,
} from "./extract-document-text";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??=
  "test-email-attachment-secret-32-chars";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");

const SAMPLE_PDF = readFileSync(join(FIXTURES, "sample.pdf"));

// A minimal BIFF8 workbook in an OLE container, one text cell.
const SAMPLE_XLS = readFileSync(join(FIXTURES, "sample.xls"));

const SAMPLE_XLS_CELL = "nakama xls cell";

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

const mailboxId = getMailboxIdentity(toMailboxConfig(completeConfig));

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
  test("extracts a mail PDF and prefixes the untrusted-document notice", async () => {
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
    expect("text" in result && result.text).toStartWith(
      `${UNTRUSTED_DOCUMENT_GUIDANCE}\n\n`
    );
    expect("text" in result && result.text.toLowerCase()).toContain("dummy");
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
      {
        // SAFETY: This test loader uses only the configuration values checked by the tool.
        loadConfig: async () => ({}) as typeof completeConfig,
      }
    );

    expect(result).toMatchObject({
      filename: "provider.pdf",
      mediaType: "application/pdf",
      untrustedContent: true,
    });
    expect("text" in result && result.text.toLowerCase()).toContain("dummy");
  });

  test("reads a stored text file up to the result limit", async () => {
    const file = Buffer.alloc(5 * 1024 * 1024, "line of notes\n");

    const result = await runExtractDocumentText(
      { documentRef: "att_notes" },
      {
        ...context,
        loadAttachment: async () => ({
          bytes: file,
          filename: "notes.txt",
          mediaType: "text/plain",
        }),
      },
      {
        // SAFETY: This test loader uses only the configuration values checked by the tool.
        loadConfig: async () => ({}) as typeof completeConfig,
      }
    );

    expect(result).toMatchObject({ mediaType: "text/plain", truncated: true });

    const text = "text" in result ? result.text : "";

    const body = text.slice(UNTRUSTED_DOCUMENT_GUIDANCE.length + 2, -1);

    expect(body.length).toBe(MAX_EMAIL_BODY_BYTES);
    expect(file.toString("utf8").startsWith(body)).toBe(true);
  });

  test("reads a stored legacy .xls", async () => {
    const result = await runExtractDocumentText(
      { documentRef: "att_sheet" },
      {
        ...context,
        loadAttachment: async () => ({
          bytes: SAMPLE_XLS,
          filename: "sheet.xls",
          mediaType: "application/vnd.ms-excel",
        }),
      },
      {
        // SAFETY: This test loader uses only the configuration values checked by the tool.
        loadConfig: async () => ({}) as typeof completeConfig,
      }
    );

    expect(result).toMatchObject({
      mediaType: "application/vnd.ms-excel",
      untrustedContent: true,
    });
    expect("text" in result ? result.text : "").toContain(SAMPLE_XLS_CELL);
  });

  test("still refuses a legacy .doc", async () => {
    const result = await runExtractDocumentText(
      { documentRef: "att_doc" },
      {
        ...context,
        loadAttachment: async () => ({
          bytes: SAMPLE_XLS,
          filename: "report.doc",
          mediaType: "application/msword",
        }),
      },
      {
        // SAFETY: This test loader uses only the configuration values checked by the tool.
        loadConfig: async () => ({}) as typeof completeConfig,
      }
    );

    expect(result).toEqual({ error: LEGACY_DOC_UNSUPPORTED_MESSAGE });
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
