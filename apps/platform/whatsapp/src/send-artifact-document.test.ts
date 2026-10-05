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
    expect(result.error).toBeTruthy();
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

test("upload deadline reports unknown, settles late rejection, and never retries", async () => {
  let attempts = 0;
  let rejectUpload: (error: Error) => void = () => {};
  const socket = {
    sendMessage: () => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        rejectUpload = reject;
      });
    },
  } as unknown as WASocket;
  const result = await sendWhatsAppArtifactDocument(
    socket,
    "1@s.whatsapp.net",
    {
      bytes: new Uint8Array([1]),
      filename: "a.csv",
      mimeType: "text/csv",
    },
    { timeoutMs: 5 }
  );
  expect(result.status).toBe("unknown");
  expect(result.ok).toBe(false);
  rejectUpload(new Error("late rejection"));
  await new Promise((resolve) => setTimeout(resolve, 1));
  expect(attempts).toBe(1);
});

test("cancellation before upload sends nothing; cancellation in flight has unknown outcome", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const socket = {
    sendMessage: () => {
      attempts += 1;
      controller.abort();
      return new Promise(() => {});
    },
  } as unknown as WASocket;
  const input = {
    bytes: new Uint8Array([1]),
    filename: "a.csv",
    mimeType: "text/csv",
  };
  expect(
    (
      await sendWhatsAppArtifactDocument(socket, "1@s.whatsapp.net", input, {
        signal: controller.signal,
      })
    ).status
  ).toBe("unknown");
  expect(attempts).toBe(1);
  expect(
    (
      await sendWhatsAppArtifactDocument(socket, "1@s.whatsapp.net", input, {
        signal: controller.signal,
      })
    ).status
  ).toBe("failed");
  expect(attempts).toBe(1);
});
