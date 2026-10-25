import { describe, expect, test } from "bun:test";
import {
  columnIndexToLetter,
  parseSpreadsheetText,
  serializeSpreadsheetText,
} from "./artifact-spreadsheet";

describe("artifact spreadsheet", () => {
  test("round-trips csv edits including quoted commas", () => {
    const rows = parseSpreadsheetText(
      "customers.csv",
      'name,company\n"Ada, Lovelace",Acme\n'
    );

    expect(rows).toEqual([
      ["name", "company"],
      ["Ada, Lovelace", "Acme"],
    ]);

    rows[1]![1] = "Northstar";
    expect(serializeSpreadsheetText("customers.csv", rows)).toBe(
      'name,company\n"Ada, Lovelace",Northstar\n'
    );
  });

  test("maps column indexes to spreadsheet letters", () => {
    expect(columnIndexToLetter(0)).toBe("A");
    expect(columnIndexToLetter(25)).toBe("Z");
    expect(columnIndexToLetter(26)).toBe("AA");
    expect(columnIndexToLetter(27)).toBe("AB");
  });
});
