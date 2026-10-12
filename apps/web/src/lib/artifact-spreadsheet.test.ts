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

  test("parses and serializes tsv with tabs", () => {
    const rows = parseSpreadsheetText("rates.tsv", "a\tb\n1\t2\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(serializeSpreadsheetText("rates.tsv", rows)).toBe("a\tb\n1\t2\n");
  });

  test("pads short rows to a rectangular grid", () => {
    expect(parseSpreadsheetText("pad.csv", "a,b,c\n1\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  test("maps column indexes to spreadsheet letters", () => {
    expect(columnIndexToLetter(0)).toBe("A");
    expect(columnIndexToLetter(25)).toBe("Z");
    expect(columnIndexToLetter(26)).toBe("AA");
    expect(columnIndexToLetter(27)).toBe("AB");
  });
});
