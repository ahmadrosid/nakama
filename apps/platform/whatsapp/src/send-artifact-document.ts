import { WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES } from "@nakama/core";
import type { WASocket } from "@whiskeysockets/baileys";

export { WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES } from "@nakama/core";

export interface SendWhatsAppArtifactDocumentInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface SendWhatsAppArtifactDocumentResult {
  error?: string;
  ok: boolean;
  status: "sent" | "failed" | "unknown";
}

export function formatWhatsAppArtifactOversizeError(bytes: number): string {
  return `File is too large for WhatsApp attach (${formatMegabytes(bytes)}; max ${formatMegabytes(WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES)}). Download it from Artifacts in Nakama.`;
}

export async function sendWhatsAppArtifactDocument(
  socket: WASocket,
  jid: string,
  input: SendWhatsAppArtifactDocumentInput,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<SendWhatsAppArtifactDocumentResult> {
  if (input.bytes.byteLength > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES) {
    return {
      error: formatWhatsAppArtifactOversizeError(input.bytes.byteLength),
      ok: false,
      status: "failed",
    };
  }

  const mimeType = input.mimeType.trim() || "application/octet-stream";

  if (options.signal?.aborted) {
    return {
      error: "Stopped before uploading the document.",
      ok: false,
      status: "failed",
    };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SendWhatsAppArtifactDocumentResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () =>
      finish({
        error: "Stopped during upload. Document delivery is unconfirmed.",
        ok: false,
        status: "unknown",
      });
    const timer = setTimeout(
      () =>
        finish({
          error:
            "Document upload timed out. Delivery is unconfirmed; check the chat before retrying.",
          ok: false,
          status: "unknown",
        }),
      options.timeoutMs ?? 30_000
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // Baileys cannot cancel sendMessage. Late settlements are handled, never retried.
    Promise.resolve()
      .then(() => {
        options.signal?.throwIfAborted();
        return socket.sendMessage(jid, {
          document: Buffer.from(input.bytes),
          fileName: input.filename,
          mimetype: mimeType,
        });
      })
      .then(
        () => finish({ ok: true, status: "sent" }),
        (error) =>
          finish({
            error:
              error instanceof Error
                ? error.message
                : "Failed to send document.",
            ok: false,
            status: "failed",
          })
      );
  });
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
