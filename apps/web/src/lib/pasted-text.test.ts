import { describe, expect, test } from "bun:test";
import type { MessageContentPart } from "@nakama/core/contract";
import type { FileUIPart } from "./ai-ui-types";
import {
  documentDisplayFromContentPart,
  documentDisplayFromFilePart,
} from "./pasted-text";

describe("documentDisplayFromContentPart", () => {
  test("carries the attachmentId through for a persisted document_ref", () => {
    const part: MessageContentPart = {
      attachmentId: "att_123",
      filename: "spec.pdf",
      mediaType: "application/pdf",
      size: 1024,
      type: "document_ref",
    };

    expect(documentDisplayFromContentPart(part)).toEqual({
      attachmentId: "att_123",
      filename: "spec.pdf",
      mediaType: "application/pdf",
    });
  });

  test("builds a data: URL for an inline document", () => {
    const part: MessageContentPart = {
      data: "aGVsbG8=",
      filename: "notes.txt",
      mediaType: "text/plain",
      type: "document",
    };

    expect(documentDisplayFromContentPart(part)).toEqual({
      filename: "notes.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,aGVsbG8=",
    });
  });
});

describe("documentDisplayFromFilePart", () => {
  test("carries the file's data: URL through", () => {
    const file: FileUIPart = {
      filename: "report.md",
      mediaType: "text/markdown",
      type: "file",
      url: "data:text/markdown;base64,IyBUaXRsZQ==",
    };

    expect(documentDisplayFromFilePart(file)).toEqual({
      filename: "report.md",
      mediaType: "text/markdown",
      url: "data:text/markdown;base64,IyBUaXRsZQ==",
    });
  });
});
