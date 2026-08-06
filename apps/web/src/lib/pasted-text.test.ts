import { describe, expect, test } from "bun:test";
import {
  countWords,
  createPastedTextFile,
  isPastedTextDocument,
  pastedTextFilename,
  wordCountFromPastedFilename,
} from "./pasted-text";

describe("countWords", () => {
  test("counts whitespace-separated tokens", () => {
    expect(countWords("one two three")).toBe(3);
  });

  test("normalizes Windows line endings", () => {
    expect(countWords("a\r\nb\rc")).toBe(3);
  });

  test("returns 0 for empty text", () => {
    expect(countWords("   \n\t  ")).toBe(0);
  });

});

describe("createPastedTextFile", () => {
  test("names file with word count", () => {
    const text = Array.from({ length: 301 }, (_, i) => `word${i}`).join(" ");
    const file = createPastedTextFile(text);

    expect(file.type.startsWith("text/plain")).toBe(true);
    expect(file.name).toBe(pastedTextFilename(301));
    expect(isPastedTextDocument(file.name, file.type)).toBe(true);
    expect(wordCountFromPastedFilename(file.name)).toBe(301);
  });
});
