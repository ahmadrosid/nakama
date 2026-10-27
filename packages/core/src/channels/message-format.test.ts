import { describe, expect, test } from "bun:test";
import { splitTelegramChunks, truncateForChannel } from "./message-format";

describe("truncateForChannel", () => {
  test("truncates long whatsapp messages to 4096", () => {
    const text = "x".repeat(5000);
    const truncated = truncateForChannel(text, "whatsapp");

    expect(truncated.length).toBeLessThanOrEqual(4096);
    expect(truncated).toContain("truncated");
  });
});

describe("splitTelegramChunks", () => {
  test("splits oversized messages", () => {
    const chunks = splitTelegramChunks("a".repeat(5000), 1000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join("")).toBe("a".repeat(5000));
  });

  test("splits at a space when a paragraph has no newline", () => {
    const words = Array.from({ length: 100 }, (_, index) => `word${index}`);
    const chunks = splitTelegramChunks(words.join(" "), 60);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 60)).toBe(true);
    expect(chunks.join(" ").split(" ")).toEqual(words);
  });

  test("closes and reopens a code fence across chunks", () => {
    const codeLines = Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0 ? `const value${index} = ${index};` : `  call(${index});`
    );

    const text = ["Intro", "```ts", ...codeLines, "```", "Outro"].join("\n");
    const chunks = splitTelegramChunks(text, 120);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);

    for (const chunk of chunks) {
      const fenceLines = chunk
        .split("\n")
        .filter((line) => line.trim().startsWith("```"));

      expect(fenceLines.length % 2).toBe(0);
    }

    expect(chunks.slice(1).every((chunk) => chunk.startsWith("```ts\n"))).toBe(
      true
    );

    const deliveredLines = chunks.flatMap((chunk) => chunk.split("\n"));

    expect(deliveredLines.filter((line) => codeLines.includes(line))).toEqual(
      codeLines
    );
    expect(chunks.at(-1)?.endsWith("```\nOutro")).toBe(true);
  });
});
