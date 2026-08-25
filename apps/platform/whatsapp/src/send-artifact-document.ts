import type { WASocket } from "@whiskeysockets/baileys";

/**
 * Memory/Buffer safety budget for in-process Baileys document uploads.
 * Not a claim about WhatsApp's absolute document ceiling — share link remains the fallback.
 */
export const WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES = 16 * 1024 * 1024;

export interface SendWhatsAppArtifactDocumentInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface SendWhatsAppArtifactDocumentResult {
  error?: string;
  ok: boolean;
}

export function formatWhatsAppArtifactOversizeError(bytes: number): string {
  return `File is too large for WhatsApp attach (${formatMegabytes(bytes)}; max ${formatMegabytes(WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES)}). Use the share link instead.`;
}

export async function sendWhatsAppArtifactDocument(
  socket: WASocket,
  jid: string,
  input: SendWhatsAppArtifactDocumentInput
): Promise<SendWhatsAppArtifactDocumentResult> {
  if (input.bytes.byteLength > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES) {
    return {
      error: formatWhatsAppArtifactOversizeError(input.bytes.byteLength),
      ok: false,
    };
  }

  const mimeType = input.mimeType.trim() || "application/octet-stream";

  try {
    await socket.sendMessage(jid, {
      document: Buffer.from(input.bytes),
      fileName: input.filename,
      mimetype: mimeType,
    });
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to send document.",
      ok: false,
    };
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
