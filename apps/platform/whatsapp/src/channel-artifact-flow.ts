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
  workspaceId?: string;
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
    typeof input.sizeBytes === "number" &&
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
        workspaceId: input.workspaceId,
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

export function parsePreparedWhatsAppArtifact(result: unknown): {
  filename: string;
  mimeType: string;
  path: string;
  workspaceId?: string;
  sizeBytes: number;
  sha256: string;
} | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (
    record.ok !== true ||
    record.status !== "prepared" ||
    typeof record.path !== "string" ||
    typeof record.filename !== "string" ||
    typeof record.mimeType !== "string" ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    typeof record.sizeBytes !== "number" ||
    !Number.isSafeInteger(record.sizeBytes) ||
    record.sizeBytes < 0 ||
    record.sizeBytes > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES
  ) {
    return null;
  }
  const path = record.path;
  if (
    !path ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return {
    ...(typeof record.workspaceId === "string"
      ? { workspaceId: record.workspaceId }
      : {}),
    filename: record.filename,
    mimeType: record.mimeType,
    path,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
  };
}
