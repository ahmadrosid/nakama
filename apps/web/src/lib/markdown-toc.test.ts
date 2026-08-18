import { describe, expect, test } from "bun:test";
import { extractMarkdownHeadings } from "./markdown-toc";

describe("extractMarkdownHeadings", () => {
  test("lists h1 to h3 in document order", () => {
    const headings = extractMarkdownHeadings(
      ["# Script", "intro", "## Hook", "### Beat one", "#### Detail"].join("\n")
    );

    expect(headings).toEqual([
      { level: 1, occurrence: 0, text: "Script" },
      { level: 2, occurrence: 0, text: "Hook" },
      { level: 3, occurrence: 0, text: "Beat one" },
    ]);
  });

  test("numbers repeated titles so each entry keeps its own target", () => {
    const headings = extractMarkdownHeadings(
      ["## Hook", "a", "## Body", "b", "## Hook", "c"].join("\n")
    );

    expect(headings.map((heading) => heading.occurrence)).toEqual([0, 0, 1]);
  });

  test("ignores hashes inside fenced code", () => {
    const headings = extractMarkdownHeadings(
      ["# Real", "```sh", "# not a heading", "```", "## Also real"].join("\n")
    );

    expect(headings.map((heading) => heading.text)).toEqual([
      "Real",
      "Also real",
    ]);
  });

  test("ignores an indented code block and a bare hash", () => {
    const headings = extractMarkdownHeadings(
      ["    # indented code", "#no space", " ### Kept"].join("\n")
    );

    expect(headings.map((heading) => heading.text)).toEqual(["Kept"]);
  });

  test("reduces inline markup to the text the DOM will render", () => {
    const headings = extractMarkdownHeadings(
      "## **Hook** with [a link](https://example.com) and `code` ##"
    );

    expect(headings[0].text).toBe("Hook with a link and code");
  });
});
