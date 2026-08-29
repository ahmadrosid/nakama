import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { MAX_DOCUMENT_BYTES } from "@nakama/core/message-content";
import type { Context } from "grammy";
import {
  buildTelegramDocumentInput,
  downloadTelegramFile,
  OVERSIZED_FILE_REPLY,
  UNSUPPORTED_DOCUMENT_TYPES_REPLY,
} from "./attachments";

function createDocumentContext(options: {
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  fileSize?: number;
}): Context {
  return {
    api: {
      getFile: async () => ({
        file_path: "documents/report.pdf",
        file_size: options.fileSize,
      }),
      token: "test-token",
    },
    message: {
      caption: options.caption,
      document: {
        file_id: options.fileId ?? "file-1",
        file_name: options.fileName,
        file_size: options.fileSize,
        mime_type: options.mimeType,
      },
    },
  } as unknown as Context;
}

describe("buildTelegramDocumentInput", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("accepts pdf with caption", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("pdf-bytes", {
        headers: { "content-type": "application/pdf" },
      })
    );

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        caption: "Summarize this",
        fileName: "report.pdf",
        mimeType: "application/pdf",
      })
    );

    expect(result).toEqual({
      input: {
        documents: [
          expect.objectContaining({
            data: Buffer.from("pdf-bytes").toString("base64"),
            filename: "report.pdf",
            mediaType: "application/pdf",
          }),
        ],
        message: "Summarize this",
      },
      kind: "input",
    });
  });

  test("accepts txt via filename when mime is octet-stream", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("hello", {
        headers: { "content-type": "application/octet-stream" },
      })
    );

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "notes.txt",
        mimeType: "application/octet-stream",
      })
    );

    expect(result?.kind).toBe("input");
    if (result?.kind === "input") {
      expect(result.input.documents?.[0]?.mediaType).toBe("text/plain");
    }
  });

  test("rejects xlsx documents", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("xlsx-bytes", {
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      })
    );

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "sheet.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );

    expect(result).toEqual({
      kind: "reject",
      message: UNSUPPORTED_DOCUMENT_TYPES_REPLY,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects oversized files before fetch when file_size is known", async () => {
    fetchSpy = spyOn(globalThis, "fetch");

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "big.pdf",
        fileSize: MAX_DOCUMENT_BYTES + 1,
        mimeType: "application/pdf",
      })
    );

    expect(result).toEqual({ kind: "reject", message: OVERSIZED_FILE_REPLY });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns null for image documents", async () => {
    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "photo.png",
        mimeType: "image/png",
      })
    );

    expect(result).toBeNull();
  });
});

describe("downloadTelegramFile", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("surfaces download failures to caller", async () => {
    const ctx = {
      api: {
        getFile: async () => {
          throw new Error("network down");
        },
        token: "test-token",
      },
    } as unknown as Context;

    await expect(
      downloadTelegramFile(ctx, "file-1", MAX_DOCUMENT_BYTES)
    ).rejects.toThrow("network down");
  });

  test("aborts while streaming once the body exceeds the cap", async () => {
    const maxBytes = 8;
    let pulls = 0;

    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (pulls === 1) {
              controller.enqueue(new Uint8Array(4).fill(65));
            } else if (pulls === 2) {
              controller.enqueue(new Uint8Array(8).fill(66));
            }
            // Cap exceeded should cancel before we keep producing forever.
          },
        }),
        {
          headers: { "content-type": "application/pdf" },
          status: 200,
        }
      )
    );

    const ctx = {
      api: {
        getFile: async () => ({
          file_path: "documents/big.pdf",
        }),
        token: "test-token",
      },
    } as unknown as Context;

    await expect(downloadTelegramFile(ctx, "file-1", maxBytes)).rejects.toThrow(
      "File is too large."
    );
    expect(pulls).toBeLessThanOrEqual(3);
  });

  test("rejects oversized body when file_size is omitted", async () => {
    const maxBytes = 8;
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(maxBytes + 1).fill(66), {
        headers: { "content-type": "application/pdf" },
        status: 200,
      })
    );

    const ctx = {
      api: {
        getFile: async () => ({
          file_path: "documents/liar.pdf",
        }),
        token: "test-token",
      },
    } as unknown as Context;

    await expect(downloadTelegramFile(ctx, "file-1", maxBytes)).rejects.toThrow(
      "File is too large."
    );
  });
});
