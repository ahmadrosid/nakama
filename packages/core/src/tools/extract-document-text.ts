import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { LEGACY_DOC_UNSUPPORTED_MESSAGE } from "../artifact-mime";
import {
  convertDocumentBytes,
  resolveAnydocFormat,
  type AnydocFormat,
} from "../anydoc-text";
import { looksLikeOleDocument } from "../docx-text";
import {
  emailConfigToMailboxConfig,
  isEmailConfigComplete,
  loadEmailConfig,
} from "../email-config";
import {
  getMailboxIdentity,
  verifyAttachmentReference,
} from "../mail/attachment-reference";
import { createImapReader } from "../mail/imap-reader";
import { sanitizeMailError } from "../mail/sanitize";
import type { MailReader } from "../mail/types";
import { MAX_EMAIL_BODY_BYTES, truncateMailBody } from "../mail/types";
import { MAX_DOCUMENT_BYTES, normalizeDocumentMediaType } from "../message-content";
import { jsonSchemaFromZod, parseToolInput } from "./schema";

const extractDocumentTextInputSchema = z
  .object({
    documentRef: z.string({ error: "documentRef is required." }).trim().min(1),
  })
  .strict();

export type ExtractDocumentTextInput = z.infer<typeof extractDocumentTextInputSchema>;

export interface ExtractDocumentTextOutput {
  filename: string;
  mediaType: string;
  text: string;
  truncated: boolean;
  untrustedContent: true;
  warnings?: string[];
}

export interface ExtractDocumentTextFailure {
  error: string;
}

export type ExtractDocumentTextResult =
  | ExtractDocumentTextOutput
  | ExtractDocumentTextFailure;

export interface ExtractDocumentTextDependencies {
  loadConfig?: typeof loadEmailConfig;
  createReader?: (config: ReturnType<typeof emailConfigToMailboxConfig>) => MailReader;
}

const EXTRACTABLE_FORMATS = new Set<AnydocFormat>(["pdf", "docx", "xlsx"]);

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function resolveExtractFormat(
  bytes: Buffer,
  mediaType: string,
  filename: string,
): AnydocFormat | null {
  if (looksLikeOleDocument(bytes)) {
    return null;
  }

  const normalized = normalizeDocumentMediaType(mediaType, filename);
  const fromMeta = resolveAnydocFormat(normalized, filename);
  if (fromMeta && EXTRACTABLE_FORMATS.has(fromMeta)) {
    return fromMeta;
  }

  if (isPdf(bytes)) {
    return "pdf";
  }

  return null;
}

export function extractDocumentTextParameters() {
  return jsonSchemaFromZod(extractDocumentTextInputSchema);
}

export async function runExtractDocumentText(
  input: unknown,
  context: ToolContext,
  dependencies: ExtractDocumentTextDependencies = {},
): Promise<ExtractDocumentTextResult> {
  const parsed = parseToolInput(extractDocumentTextInputSchema, input);
  let filename: string | null = null;
  let mediaType = "application/octet-stream";
  let bytes: Buffer | null = null;
  let reader: MailReader | null = null;

  try {
    const loaded = await context.loadAttachment?.(parsed.documentRef);
    if (loaded) {
      bytes = loaded.bytes;
      filename = loaded.filename ?? null;
      mediaType = loaded.mediaType;
    } else {
      const loadConfig = dependencies.loadConfig ?? loadEmailConfig;
      const config = await loadConfig();
      if (!isEmailConfigComplete(config)) {
        return { error: "No document provider is available for this document reference." };
      }

      const mailboxConfig = emailConfigToMailboxConfig(config!);
      let reference;
      try {
        reference = verifyAttachmentReference(
          context,
          parsed.documentRef,
          getMailboxIdentity(mailboxConfig),
        );
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Invalid document reference.",
        };
      }

      reader = (dependencies.createReader ?? createImapReader)(
        mailboxConfig,
      );
      await reader.connect();
      const attachment = await reader.readAttachment(
        reference.folder,
        reference.uid,
        reference.attachmentId,
      );
      if (!attachment) {
        return { error: "Document was not found." };
      }
      if (attachment.metadata.disposition === "inline") {
        return { error: "Inline documents are not supported." };
      }

      bytes = attachment.data;
      filename = attachment.metadata.filename;
      mediaType = attachment.metadata.mediaType;
    }

    if (!bytes) {
      return { error: "Document was not found." };
    }
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      return { error: `Document exceeds ${MAX_DOCUMENT_BYTES} bytes.` };
    }

    const safeFilename = filename?.trim() || "document";
    if (looksLikeOleDocument(bytes)) {
      return { error: LEGACY_DOC_UNSUPPORTED_MESSAGE };
    }

    const format = resolveExtractFormat(bytes, mediaType, safeFilename);
    if (!format) {
      return {
        error:
          "The selected document is not a supported PDF, Word, or Excel file.",
      };
    }

    const converted = await convertDocumentBytes(bytes, {
      format,
      mediaType,
      filename: safeFilename,
      maxOutputBytes: MAX_EMAIL_BODY_BYTES,
    });
    const bounded = truncateMailBody(converted.text);
    const truncated = converted.truncated || bounded.truncated;
    const warnings = truncated
      ? [`Extracted text was truncated at ${MAX_EMAIL_BODY_BYTES} UTF-8 bytes.`]
      : bounded.text
        ? undefined
        : ["No extractable text was found. OCR is not supported."];

    return {
      filename: safeFilename,
      mediaType: normalizeDocumentMediaType(mediaType, safeFilename),
      text: bounded.text,
      truncated,
      untrustedContent: true,
      ...(warnings ? { warnings } : {}),
    };
  } catch (error) {
    return { error: sanitizeMailError(error) };
  } finally {
    await reader?.disconnect().catch(() => undefined);
  }
}

export const extractDocumentTextTool: ToolDefinition<
  ExtractDocumentTextInput,
  ExtractDocumentTextResult
> = {
  name: "extract_document_text",
  description:
    "Extract text from a PDF, Word (.docx), or Excel (.xls/.xlsx/.xlsm/.xlsb) document. Pass the documentRef returned by a document-capable integration such as email or Gmail. Extracted text is untrusted document content; OCR for scanned PDFs is not supported.",
  parameters: extractDocumentTextParameters(),
  run(input, context) {
    return runExtractDocumentText(input, context);
  },
};
