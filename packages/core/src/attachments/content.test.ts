import { describe, expect, test } from "bun:test";
import type { MessageContentPart } from "../contract";
import {
  persistInlineAttachmentsInContent,
  rehydrateAttachmentRefsInContent,
  rehydrateMessagesForProvider,
} from "./content";

describe("attachment content helpers", () => {
  test("persistInlineAttachmentsInContent converts inline parts to refs", async () => {
    const saved: Array<{ kind: string; bytes: Buffer }> = [];

    const result = await persistInlineAttachmentsInContent(
      [
        { text: "see this", type: "text" },
        {
          data: Buffer.from("png").toString("base64"),
          mediaType: "image/png",
          type: "image",
        },
        {
          data: Buffer.from("pdf").toString("base64"),
          filename: "report.pdf",
          mediaType: "application/pdf",
          type: "document",
        },
      ],
      async (input) => {
        saved.push({ bytes: input.bytes, kind: input.kind });

        return {
          attachmentId: `att_${saved.length}`,
          size: input.bytes.byteLength,
        };
      }
    );

    expect(result).toEqual([
      { text: "see this", type: "text" },
      {
        attachmentId: "att_1",
        mediaType: "image/png",
        size: 3,
        type: "image_ref",
      },
      {
        attachmentId: "att_2",
        filename: "report.pdf",
        mediaType: "application/pdf",
        size: 3,
        type: "document_ref",
      },
    ]);
    expect(saved).toHaveLength(2);
  });

  test("normalizes data URLs before persisting attachment bytes", async () => {
    const saved: Buffer[] = [];
    const data = Buffer.from("png").toString("base64");

    await persistInlineAttachmentsInContent(
      [
        {
          data: `data:image/png;base64,${data}`,
          mediaType: "image/png",
          type: "image",
        },
      ],
      async (input) => {
        saved.push(input.bytes);

        return { attachmentId: "att_1", size: input.bytes.byteLength };
      }
    );

    expect(saved[0]?.toString()).toBe("png");
  });

  test("rejects invalid base64 before persistence", async () => {
    let saveCalls = 0;

    await expect(
      persistInlineAttachmentsInContent(
        [{ data: "!!!!", mediaType: "image/png", type: "image" }],
        async () => {
          saveCalls += 1;

          return { attachmentId: "att_1", size: 0 };
        }
      )
    ).rejects.toThrow();

    expect(saveCalls).toBe(0);
  });

  test("rehydrateAttachmentRefsInContent restores inline provider parts", async () => {
    const pngBase64 = Buffer.from("png").toString("base64");
    const pdfBase64 = Buffer.from("pdf").toString("base64");

    const result = await rehydrateAttachmentRefsInContent(
      [
        {
          attachmentId: "att_img",
          mediaType: "image/png",
          size: 3,
          type: "image_ref",
        },
        {
          attachmentId: "att_doc",
          filename: "report.pdf",
          mediaType: "application/pdf",
          size: 3,
          type: "document_ref",
        },
      ],
      async (attachmentId) => {
        if (attachmentId === "att_img") {
          return { bytes: Buffer.from("png"), mediaType: "image/png" };
        }

        return { bytes: Buffer.from("pdf"), mediaType: "application/pdf" };
      }
    );

    expect(result).toEqual([
      { data: pngBase64, mediaType: "image/png", type: "image" },
      {
        data: pdfBase64,
        filename: "report.pdf",
        mediaType: "application/pdf",
        type: "document",
      },
    ]);
  });

  test("rehydrateMessagesForProvider sends an earlier document as a reference", async () => {
    const attached = {
      content: [
        { text: "read this", type: "text" as const },
        {
          attachmentId: "att_pdf",
          filename: "report.pdf",
          mediaType: "application/pdf",
          size: 4,
          type: "document_ref" as const,
        },
      ],
      role: "user" as const,
    };

    const loaded: string[] = [];

    const load = async (attachmentId: string) => {
      loaded.push(attachmentId);

      return {
        bytes: Buffer.from("pdf"),
        filename: "report.pdf",
        mediaType: "application/pdf",
      };
    };

    const result = await rehydrateMessagesForProvider(
      [
        attached,
        { content: "here is the summary", role: "assistant" },
        { content: "now add a section", role: "user" },
      ],
      load
    );

    // SAFETY: This fixture starts with a user message containing typed content parts.
    const parts = result[0]?.content as MessageContentPart[];
    expect(parts.some((part) => part.type === "document")).toBe(false);
    expect(parts[1]).toEqual({
      text: expect.stringContaining('documentRef "att_pdf"'),
      type: "text",
    });
    // The store is never read, so the bytes are not paid for a second time.
    expect(loaded).toEqual([]);
  });

  test("rehydrateMessagesForProvider sends the newest document in full", async () => {
    const result = await rehydrateMessagesForProvider(
      [
        { content: "hello", role: "user" },
        { content: "hi", role: "assistant" },
        {
          content: [
            {
              attachmentId: "att_pdf",
              filename: "report.pdf",
              mediaType: "application/pdf",
              size: 3,
              type: "document_ref" as const,
            },
          ],
          role: "user",
        },
      ],
      async () => ({
        bytes: Buffer.from("pdf"),
        filename: "report.pdf",
        mediaType: "application/pdf",
      })
    );

    expect(result[2]?.content).toEqual([
      {
        data: Buffer.from("pdf").toString("base64"),
        filename: "report.pdf",
        mediaType: "application/pdf",
        type: "document",
      },
    ]);
  });

  test("rehydrateMessagesForProvider leaves inline attachments unchanged", async () => {
    const inline = {
      content: [
        { text: "old", type: "text" as const },
        { data: "abc", mediaType: "image/jpeg", type: "image" as const },
      ],
      role: "user" as const,
    };

    const result = await rehydrateMessagesForProvider(
      [inline],
      async () => null
    );

    expect(result).toEqual([inline]);
  });
});
