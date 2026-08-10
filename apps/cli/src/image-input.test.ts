import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeSendInput, parseImageLine } from "./image-input";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("parseImageLine", () => {
  test("returns null for normal text", async () => {
    expect(await parseImageLine("hello")).toBeNull();
  });

  test("parses image path with message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-cli-"));
    const path = join(dir, "test.png");
    await writeFile(path, tinyPng);

    const result = await parseImageLine(`@${path} what is this?`);

    expect(result).toEqual({
      images: [{ data: tinyPng.toString("base64"), mediaType: "image/png" }],
      message: "what is this?",
    });
  });
});

describe("mergeSendInput", () => {
  test("prefers path-based input over clipboard images", () => {
    const fromPath = {
      images: [{ data: "abc", mediaType: "image/png" }],
      message: "from file",
    };

    expect(
      mergeSendInput("ignored", {
        fromPath,
        promptImages: [{ data: "def", mediaType: "image/jpeg" }],
      })
    ).toBe(fromPath);
  });

  test("uses clipboard images when no path input", () => {
    expect(
      mergeSendInput("describe this", {
        promptImages: [{ data: "abc", mediaType: "image/png" }],
      })
    ).toEqual({
      images: [{ data: "abc", mediaType: "image/png" }],
      message: "describe this",
    });
  });
});
