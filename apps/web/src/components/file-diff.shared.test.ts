import { describe, expect, test } from "bun:test";
import { buildFileDiffRows } from "./file-diff.shared";

describe("buildFileDiffRows", () => {
  test("shows an added tool as one line instead of replacing the whole array", () => {
    const rows = buildFileDiffRows(
      '["read_file","search_files"]',
      '["bash","read_file","search_files"]',
      { formatJson: true }
    );

    expect(
      rows.filter((row) => row.type === "add").map((row) => row.text)
    ).toEqual(['  "bash",']);
    expect(rows.filter((row) => row.type === "del")).toEqual([]);
  });

  test("preserves malformed JSON and plain text when formatting structured changes", () => {
    const before = '["broken';
    const after = "plain text";
    expect(buildFileDiffRows(before, after, { formatJson: true })).toEqual(
      buildFileDiffRows(before, after)
    );
  });

  test("omits unchanged lines far from the edit", () => {
    const before = ["a0", "a1", "a2", "a3", "old", "b0", "b1", "b2", "b3"].join(
      "\n"
    );

    const after = ["a0", "a1", "a2", "a3", "new", "b0", "b1", "b2", "b3"].join(
      "\n"
    );

    const texts = buildFileDiffRows(before, after).map((row) => row.text);

    expect(texts).toEqual(["a1", "a2", "a3", "old", "new", "b0", "b1", "b2"]);
  });
});
