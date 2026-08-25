import { describe, expect, test } from "bun:test";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  sendWhatsAppArtifactDocument,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";

function mockSendMessage(options?: { throwError?: string }) {
  const calls: unknown[] = [];
  const socket = {
    sendMessage: async (_jid: string, content: unknown) => {
      if (options?.throwError) {
        throw new Error(options.throwError);
      }
      calls.push(content);
      return {};
    },
  } as unknown as WASocket;

  return { calls, socket };
}

describe("sendWhatsAppArtifactDocument", () => {
  test("sends a document under the size cap", async () => {
    const { calls, socket } = mockSendMessage();

    const result = await sendWhatsAppArtifactDocument(
      socket,
      "1@s.whatsapp.net",
      {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "notes.md",
        mimeType: "text/markdown",
      }
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fileName: "notes.md",
      mimetype: "text/markdown",
    });
  });

  test("allows files exactly at the size cap", async () => {
    const { calls, socket } = mockSendMessage();

    const result = await sendWhatsAppArtifactDocument(
      socket,
      "1@s.whatsapp.net",
      {
        bytes: new Uint8Array(WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES),
        filename: "exact.bin",
        mimeType: "application/octet-stream",
      }
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("rejects files over the size cap", async () => {
    const { calls, socket } = mockSendMessage();

    const result = await sendWhatsAppArtifactDocument(
      socket,
      "1@s.whatsapp.net",
      {
        bytes: new Uint8Array(WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES + 1),
        filename: "big.md",
        mimeType: "text/markdown",
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
    expect(result.error).toContain("share link");
    expect(calls).toHaveLength(0);
  });

  test("returns ok false when sendMessage throws", async () => {
    const { socket } = mockSendMessage({ throwError: "upload failed" });

    const result = await sendWhatsAppArtifactDocument(
      socket,
      "1@s.whatsapp.net",
      {
        bytes: new Uint8Array([1]),
        filename: "notes.md",
        mimeType: "text/markdown",
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("upload failed");
  });
});
