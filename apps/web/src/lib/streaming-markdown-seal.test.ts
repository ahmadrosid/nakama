import { describe, expect, test } from "bun:test";
import { splitStreamingMarkdown } from "./streaming-markdown-seal";

describe("splitStreamingMarkdown", () => {
  test("keeps a single incomplete paragraph in the tail", () => {
    expect(splitStreamingMarkdown("Hello world")).toEqual({
      sealed: "",
      tail: "Hello world",
    });
  });

  test("seals completed paragraphs at blank-line boundaries", () => {
    expect(splitStreamingMarkdown("First paragraph.\n\nSecond still typing")).toEqual({
      sealed: "First paragraph.\n\n",
      tail: "Second still typing",
    });
  });

  test("does not seal blank lines inside an open code fence", () => {
    const content = "Intro\n\n```js\nconst a = 1;\n\nconst b = 2;";
    expect(splitStreamingMarkdown(content)).toEqual({
      sealed: "Intro\n\n",
      tail: "```js\nconst a = 1;\n\nconst b = 2;",
    });
  });

  test("seals after a closed fence when a later blank line appears", () => {
    const content = "Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter";
    expect(splitStreamingMarkdown(content)).toEqual({
      sealed: "Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n",
      tail: "After",
    });
  });

  test("handles empty input", () => {
    expect(splitStreamingMarkdown("")).toEqual({ sealed: "", tail: "" });
  });
});
