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
        { type: "text", text: "see this" },
        { type: "image", mediaType: "image/png", data: Buffer.from("png").toString("base64") },
        {
          type: "document",
          filename: "report.pdf",
          mediaType: "application/pdf",
          data: Buffer.from("pdf").toString("base64"),
        },
      ],
      async (input) => {
        saved.push({ kind: input.kind, bytes: input.bytes });
        return { attachmentId: `att_${saved.length}`, size: input.bytes.byteLength };
      },
    );

    expect(result).toEqual([
      { type: "text", text: "see this" },
      { type: "image_ref", attachmentId: "att_1", mediaType: "image/png", size: 3 },
      {
        type: "document_ref",
        attachmentId: "att_2",
        filename: "report.pdf",
        mediaType: "application/pdf",
        size: 3,
      },
    ]);
    expect(saved).toHaveLength(2);
  });

  test("rehydrateAttachmentRefsInContent restores inline provider parts", async () => {
    const pngBase64 = Buffer.from("png").toString("base64");
    const pdfBase64 = Buffer.from("pdf").toString("base64");

    const result = await rehydrateAttachmentRefsInContent(
      [
        { type: "image_ref", attachmentId: "att_img", mediaType: "image/png", size: 3 },
        {
          type: "document_ref",
          attachmentId: "att_doc",
          filename: "report.pdf",
          mediaType: "application/pdf",
          size: 3,
        },
      ],
      async (attachmentId) => {
        if (attachmentId === "att_img") {
          return { bytes: Buffer.from("png"), mediaType: "image/png" };
        }

        return { bytes: Buffer.from("pdf"), mediaType: "application/pdf" };
      },
    );

    expect(result).toEqual([
      { type: "image", mediaType: "image/png", data: pngBase64 },
      {
        type: "document",
        filename: "report.pdf",
        mediaType: "application/pdf",
        data: pdfBase64,
      },
    ]);
  });

  test("rehydrateMessagesForProvider leaves inline attachments unchanged", async () => {
    const inline = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "old" },
        { type: "image" as const, mediaType: "image/jpeg", data: "abc" },
      ],
    };

    const result = await rehydrateMessagesForProvider([inline], async () => null);

    expect(result).toEqual([inline]);
  });
});
