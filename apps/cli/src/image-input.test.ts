import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeSendInput, parseImageLine } from "./image-input";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
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
      message: "what is this?",
      images: [{ mediaType: "image/png", data: tinyPng.toString("base64") }],
    });
  });
});

describe("mergeSendInput", () => {
  test("prefers path-based input over clipboard images", () => {
    const fromPath = {
      message: "from file",
      images: [{ mediaType: "image/png", data: "abc" }],
    };

    expect(
      mergeSendInput("ignored", {
        fromPath,
        promptImages: [{ mediaType: "image/jpeg", data: "def" }],
      }),
    ).toBe(fromPath);
  });

  test("uses clipboard images when no path input", () => {
    expect(
      mergeSendInput("describe this", {
        promptImages: [{ mediaType: "image/png", data: "abc" }],
      }),
    ).toEqual({
      message: "describe this",
      images: [{ mediaType: "image/png", data: "abc" }],
    });
  });
});
