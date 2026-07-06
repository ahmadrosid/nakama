import { describe, expect, test, spyOn, afterEach } from "bun:test";
import type { Context } from "grammy";
import { MAX_DOCUMENT_BYTES } from "@nakama/core/message-content";
import {
  buildTelegramDocumentInput,
  OVERSIZED_FILE_REPLY,
  UNSUPPORTED_DOCUMENT_TYPES_REPLY,
  downloadTelegramFile,
} from "./attachments";

function createDocumentContext(options: {
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  fileSize?: number;
}): Context {
  return {
    message: {
      caption: options.caption,
      document: {
        file_id: options.fileId ?? "file-1",
        file_name: options.fileName,
        mime_type: options.mimeType,
        file_size: options.fileSize,
      },
    },
    api: {
      token: "test-token",
      getFile: async () => ({
        file_path: "documents/report.pdf",
        file_size: options.fileSize,
      }),
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
      }),
    );

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "report.pdf",
        mimeType: "application/pdf",
        caption: "Summarize this",
      }),
    );

    expect(result).toEqual({
      kind: "input",
      input: {
        message: "Summarize this",
        documents: [
          expect.objectContaining({
            filename: "report.pdf",
            mediaType: "application/pdf",
            data: Buffer.from("pdf-bytes").toString("base64"),
          }),
        ],
      },
    });
  });

  test("accepts txt via filename when mime is octet-stream", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("hello", {
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "notes.txt",
        mimeType: "application/octet-stream",
      }),
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
      }),
    );

    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "sheet.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
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
        mimeType: "application/pdf",
        fileSize: MAX_DOCUMENT_BYTES + 1,
      }),
    );

    expect(result).toEqual({ kind: "reject", message: OVERSIZED_FILE_REPLY });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns null for image documents", async () => {
    const result = await buildTelegramDocumentInput(
      createDocumentContext({
        fileName: "photo.png",
        mimeType: "image/png",
      }),
    );

    expect(result).toBeNull();
  });
});

describe("downloadTelegramFile", () => {
  test("surfaces download failures to caller", async () => {
    const ctx = {
      api: {
        token: "test-token",
        getFile: async () => {
          throw new Error("network down");
        },
      },
    } as unknown as Context;

    await expect(downloadTelegramFile(ctx, "file-1", MAX_DOCUMENT_BYTES)).rejects.toThrow(
      "network down",
    );
  });
});
