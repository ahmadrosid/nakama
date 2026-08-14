import { describe, expect, test } from "bun:test";
import { DOCUMENT_ACCEPT, isDocumentFilePart } from "./chat-images";

describe("chat document accept", () => {
  test("includes excel extensions and spreadsheet mime types", () => {
    expect(DOCUMENT_ACCEPT).toContain(".xlsx");
    expect(DOCUMENT_ACCEPT).toContain(".xls");
    expect(DOCUMENT_ACCEPT).toContain(".md");
    expect(DOCUMENT_ACCEPT).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  test("recognizes xlsx file parts", () => {
    expect(
      isDocumentFilePart({
        filename: "budget.xlsx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        type: "file",
        url: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,YWJj",
      })
    ).toBe(true);
  });

  test("recognizes excel from extension when media type is generic", () => {
    expect(
      isDocumentFilePart({
        filename: "budget.xlsx",
        mediaType: "application/octet-stream",
        type: "file",
        url: "data:application/octet-stream;base64,YWJj",
      })
    ).toBe(true);
  });
});
