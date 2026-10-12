import { createHash } from "node:crypto";
import type { NakamaClient } from "@nakama/client";
import {
  formatMissingAttachArtifactMessage,
  getMostRecentDeliverableArtifact,
} from "@nakama/core";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  formatWhatsAppArtifactOversizeError,
  type SendWhatsAppArtifactDocumentResult,
  sendWhatsAppArtifactDocument,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";

export interface PreparedWhatsAppArtifactCandidate {
  filename?: unknown;
  mimeType?: unknown;
  ok?: unknown;
  path?: unknown;
  sha256?: unknown;
  sizeBytes?: unknown;
  status?: unknown;
}

/** `/attach` shortcut: most recent registry artifact, or a missing-artifact message. */
export async function maybeSendWhatsAppAttachOnlyCommand(input: {
  client: NakamaClient;
  conversationKey: string;
  profileId: string;
  sessionStore: ChannelSessionStore;
  socket: WASocket;
  jid: string;
  sendPlain: (text: string) => Promise<void>;
}): Promise<void> {
  const artifact = getMostRecentDeliverableArtifact(
    input.sessionStore.getDeliverableArtifacts(input.conversationKey)
  );

  if (!artifact) {
    await input.sendPlain(formatMissingAttachArtifactMessage());

    return;
  }

  await sendArtifactDocumentForPath({
    ...input,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    path: artifact.path,
    sizeBytes: artifact.sizeBytes,
  });
}

export async function sendArtifactDocumentForPath(input: {
  client: NakamaClient;
  profileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  sha256?: string;
  signal?: AbortSignal;
  socket: WASocket;
  jid: string;
  sendPlain: (text: string) => Promise<void>;
}): Promise<SendWhatsAppArtifactDocumentResult> {
  if (
    input.sizeBytes !== undefined &&
    input.sizeBytes > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES
  ) {
    const error = formatWhatsAppArtifactOversizeError(input.sizeBytes);
    await input.sendPlain(error);

    return { error, ok: false, status: "failed" };
  }

  try {
    const { contentType, data } = await input.client.readProfileArtifactContent(
      input.profileId,
      input.path,
      {
        maxBytes: WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      }
    );

    input.signal?.throwIfAborted();

    if (
      input.sha256 &&
      createHash("sha256").update(new Uint8Array(data)).digest("hex") !==
        input.sha256
    ) {
      throw new Error(
        "The selected file changed before delivery. Ask me to select it again."
      );
    }

    const result = await sendWhatsAppArtifactDocument(
      input.socket,
      input.jid,
      {
        bytes: new Uint8Array(data),
        filename: input.filename,
        mimeType:
          input.mimeType.trim() || contentType || "application/octet-stream",
      },
      { signal: input.signal }
    );

    if (!result.ok && result.error) {
      await input.sendPlain(result.error);
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to read the artifact for attachment.";

    await input.sendPlain(message);

    return { error: message, ok: false, status: "failed" };
  }
}

export function parsePreparedWhatsAppArtifact(
  result: PreparedWhatsAppArtifactCandidate
): {
  filename: string;
  mimeType: string;
  path: string;
  sizeBytes: number;
  sha256: string;
} | null {
  if (!(result instanceof Object)) {
    return null;
  }

  const candidate = result;
  const pathValue = candidate.path;
  const filenameValue = candidate.filename;
  const mimeTypeValue = candidate.mimeType;
  const sha256Value = candidate.sha256;

  const path =
    Object.prototype.toString.call(pathValue) === "[object String]"
      ? String(pathValue)
      : null;

  const filename =
    Object.prototype.toString.call(filenameValue) === "[object String]"
      ? String(filenameValue)
      : null;

  const mimeType =
    Object.prototype.toString.call(mimeTypeValue) === "[object String]"
      ? String(mimeTypeValue)
      : null;

  const sha256 =
    Object.prototype.toString.call(sha256Value) === "[object String]"
      ? String(sha256Value)
      : null;

  const rawSizeBytes = candidate.sizeBytes;

  if (
    candidate.ok !== true ||
    candidate.status !== "prepared" ||
    path === null ||
    filename === null ||
    mimeType === null ||
    sha256 === null ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(rawSizeBytes)
  ) {
    return null;
  }

  const sizeBytes = Number(rawSizeBytes);

  if (sizeBytes < 0 || sizeBytes > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES) {
    return null;
  }

  if (
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }

  return {
    filename,
    mimeType,
    path,
    sha256,
    sizeBytes,
  };
}
