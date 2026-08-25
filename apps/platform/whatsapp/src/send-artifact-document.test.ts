import { describe, expect, test } from "bun:test";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  sendWhatsAppArtifactDocument,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";

describe("sendWhatsAppArtifactDocument", () => {
  test("sends a document under the size cap", async () => {
    const calls: unknown[] = [];
    const socket = {
      sendMessage: async (_jid: string, content: unknown) => {
        calls.push(content);
        return {};
      },
    } as unknown as WASocket;

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
    const calls: unknown[] = [];
    const socket = {
      sendMessage: async (_jid: string, content: unknown) => {
        calls.push(content);
        return {};
      },
    } as unknown as WASocket;

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
    let sendCalls = 0;
    const socket = {
      sendMessage: async () => {
        sendCalls += 1;
        return {};
      },
    } as unknown as WASocket;

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
    expect(sendCalls).toBe(0);
  });

  test("returns ok false when sendMessage throws", async () => {
    const socket = {
      sendMessage: async () => {
        throw new Error("upload failed");
      },
    } as unknown as WASocket;

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
