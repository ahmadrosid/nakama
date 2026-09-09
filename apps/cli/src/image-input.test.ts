import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeSendInput,
  parseImageLine,
  resolveAllowedImagePath,
} from "./image-input";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const originalCwd = process.cwd();
const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
  }
});

describe("resolveAllowedImagePath", () => {
  test("allows a relative path under cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-cli-img-"));
    process.chdir(dir);
    await writeFile(join(dir, "shot.png"), tinyPng);

    expect(resolveAllowedImagePath("./shot.png")).toBe(
      realpathSync(join(dir, "shot.png"))
    );
  });

  test("allows a path under NAKAMA_CONFIG_DIR", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-cfg-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const nested = join(configDir, "uploads");
    await mkdir(nested);
    await writeFile(join(nested, "shot.png"), tinyPng);

    expect(resolveAllowedImagePath(join(nested, "shot.png"))).toBe(
      realpathSync(join(nested, "shot.png"))
    );
  });

  test("rejects absolute paths outside cwd and config dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-cli-img-"));
    process.chdir(dir);
    process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
      join(tmpdir(), "nakama-cfg-")
    );

    expect(() => resolveAllowedImagePath("/etc/passwd")).toThrow(
      /outside allowed directories/i
    );
  });

  test("rejects a sibling path that only shares a string prefix with cwd", async () => {
    const parent = await mkdtemp(join(tmpdir(), "nakama-cli-pfx-"));
    const cwdRoot = join(parent, "fo");
    const sibling = join(parent, "foo");
    await mkdir(cwdRoot);
    await mkdir(sibling);
    process.chdir(cwdRoot);
    process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
      join(tmpdir(), "nakama-cfg-")
    );
    await writeFile(join(sibling, "shot.png"), tinyPng);

    expect(() =>
      resolveAllowedImagePath(join(sibling, "shot.png"))
    ).toThrow(/outside allowed directories/i);
  });
});

describe("parseImageLine", () => {
  test("returns null for normal text", async () => {
    expect(await parseImageLine("hello")).toBeNull();
  });

  test("parses image path with message under cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-cli-"));
    process.chdir(dir);
    await writeFile(join(dir, "test.png"), tinyPng);

    const result = await parseImageLine("@./test.png what is this?");

    expect(result).toEqual({
      images: [{ data: tinyPng.toString("base64"), mediaType: "image/png" }],
      message: "what is this?",
    });
  });

  test("rejects image paths outside the allowlist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nakama-cli-"));
    process.chdir(dir);
    process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
      join(tmpdir(), "nakama-cfg-")
    );

    await expect(parseImageLine("@/etc/hosts look")).rejects.toThrow(
      /outside allowed directories/i
    );
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
