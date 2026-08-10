import { describe, expect, test } from "bun:test";
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
