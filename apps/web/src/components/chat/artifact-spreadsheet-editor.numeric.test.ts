import { describe, expect, test } from "bun:test";
import { isSpreadsheetNumericCell } from "./artifact-spreadsheet-editor";

describe("isSpreadsheetNumericCell", () => {
  test("detects numeric spreadsheet cells", () => {
    expect(isSpreadsheetNumericCell("14")).toBe(true);
    expect(isSpreadsheetNumericCell("-3.5")).toBe(true);
    expect(isSpreadsheetNumericCell("1,234.5")).toBe(true);
    expect(isSpreadsheetNumericCell("12%")).toBe(true);
    expect(isSpreadsheetNumericCell("20-08-2026")).toBe(false);
    expect(isSpreadsheetNumericCell("optimasi")).toBe(false);
    expect(isSpreadsheetNumericCell("")).toBe(false);
  });
});
