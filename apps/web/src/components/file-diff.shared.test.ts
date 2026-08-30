import { describe, expect, test } from "bun:test";
import { buildFileDiffRows } from "./file-diff.shared";

describe("buildFileDiffRows", () => {
  test("returns no rows when both sides are empty", () => {
    expect(buildFileDiffRows(null, null)).toEqual([]);
    expect(buildFileDiffRows("", "")).toEqual([]);
  });

  test("treats a new file as additions", () => {
    expect(buildFileDiffRows(null, "alpha\nbeta")).toEqual([
      { cur: 1, old: null, text: "alpha", type: "add" },
      { cur: 2, old: null, text: "beta", type: "add" },
    ]);
  });

  test("treats a cleared file as deletions", () => {
    expect(buildFileDiffRows("alpha\nbeta", null)).toEqual([
      { cur: null, old: 1, text: "alpha", type: "del" },
      { cur: null, old: 2, text: "beta", type: "del" },
    ]);
  });

  test("keeps matching lines as context around a replacement", () => {
    const rows = buildFileDiffRows(
      ["keep", "old", "tail"].join("\n"),
      ["keep", "new", "tail"].join("\n")
    );

    expect(rows).toEqual([
      { cur: 1, old: 1, text: "keep", type: "ctx" },
      { cur: null, old: 2, text: "old", type: "del" },
      { cur: 2, old: null, text: "new", type: "add" },
      { cur: 3, old: 3, text: "tail", type: "ctx" },
    ]);
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
