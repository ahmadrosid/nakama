import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { MAX_DOCUMENT_BYTES } from "@nakama/core/message-content";
import type { Context } from "grammy";
import {
  buildTelegramDocumentInput,
  buildTelegramFileDownloadUrl,
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

describe("buildTelegramFileDownloadUrl", () => {
  test("puts token in an encoded path segment", () => {
    const url = buildTelegramFileDownloadUrl(
      "123456:ABC-DEF/ghi_jkl",
      "photos/file_0.jpg"
    );

    expect(url.origin).toBe("https://api.telegram.org");
    expect(url.pathname).toBe(
      `/file/${encodeURIComponent("bot123456:ABC-DEF/ghi_jkl")}/photos/file_0.jpg`
    );
    expect(url.href).not.toContain("123456:ABC-DEF/ghi_jkl");
  });

  test("encodes each file path segment", () => {
    const url = buildTelegramFileDownloadUrl("tok", "dir/name with space.pdf");

    expect(url.pathname).toBe(
      `/file/${encodeURIComponent("bottok")}/dir/name%20with%20space.pdf`
    );
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

  test("fetches via URL with token as path segment", async () => {
    const token = "123456:ABC-DEF";
    const filePath = "documents/report.pdf";
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("pdf-bytes", {
        headers: { "content-type": "application/pdf" },
      })
    );

    const ctx = {
      api: {
        getFile: async () => ({
          file_path: filePath,
          file_size: 9,
        }),
        token,
      },
    } as unknown as Context;

    const result = await downloadTelegramFile(ctx, "file-1", MAX_DOCUMENT_BYTES);

    expect(result.filePath).toBe(filePath);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetched = fetchSpy.mock.calls[0]?.[0];
    expect(fetched).toBeInstanceOf(URL);
    expect((fetched as URL).href).toBe(
      buildTelegramFileDownloadUrl(token, filePath).href
    );
  });
});
