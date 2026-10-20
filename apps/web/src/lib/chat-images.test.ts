import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_ACCEPT,
  isDocumentFilePart,
  MAX_FOLDER_BYTES,
  MAX_FOLDER_FILES,
  selectFolderFiles,
} from "./chat-images";

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

function pickedFile(path: string, type = "text/plain", size = 10): File {
  const file = new File(["x".repeat(size)], path.split("/").pop() ?? path, {
    type,
  });

  Object.defineProperty(file, "webkitRelativePath", { value: path });

  return file;
}

describe("selectFolderFiles", () => {
  test("keeps relative paths and skips hidden and unsupported files", () => {
    const result = selectFolderFiles([
      pickedFile("docs/readme.md", "text/markdown"),
      pickedFile("docs/.env", "text/plain"),
      pickedFile("docs/.git/config", "text/plain"),
      pickedFile("docs/app.bin", "application/octet-stream"),
      pickedFile("docs/img/logo.png", "image/png"),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.files.map((f) => f.name)).toEqual([
        "docs/readme.md",
        "docs/img/logo.png",
      ]);
    }
  });

  test("attaches nothing when the folder has too many files", () => {
    const many = Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, i) =>
      pickedFile(`d/f${i}.txt`)
    );

    expect(selectFolderFiles(many).ok).toBe(false);
  });

  test("attaches nothing when the folder is too large", () => {
    const result = selectFolderFiles([
      pickedFile("d/a.txt", "text/plain", MAX_FOLDER_BYTES),
      pickedFile("d/b.txt", "text/plain", 1),
    ]);

    expect(result.ok).toBe(false);
  });

  test("fails when no file is supported", () => {
    expect(
      selectFolderFiles([pickedFile("d/a.bin", "application/octet-stream")]).ok
    ).toBe(false);
  });
});
