import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathExists, readText, writeTextFile } from "./fs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

async function createExistingFile(mode: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nakama-fs-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "config.txt");
  await writeFile(path, "old", { mode });
  await chmod(path, mode);
  return path;
}

async function modeOf(path: string): Promise<number> {
  // biome-ignore lint/suspicious/noBitwiseOperators: permission bits are stored in st_mode.
  return (await stat(path)).mode & 0o777;
}

describe("writeTextFile permissions", () => {
  test("repairs an existing file to a custom mode by default", async () => {
    if (process.platform === "win32") {
      return;
    }

    const path = await createExistingFile(0o666);

    await writeTextFile(path, "new", { mode: 0o640 });

    expect(await modeOf(path)).toBe(0o640);
  });

  test("keeps existing permissions when chmod is explicitly disabled", async () => {
    if (process.platform === "win32") {
      return;
    }

    const path = await createExistingFile(0o666);

    await writeTextFile(path, "new", { chmod: false, mode: 0o640 });

    expect(await modeOf(path)).toBe(0o666);
  });
});

describe("writeTextFile atomic replace", () => {
  test("replaces the target and removes the temp file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-fs-atomic-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "cli.ini");

    await writeTextFile(path, "profile_id=one\n");
    await writeTextFile(path, "profile_id=two\n");

    expect(await readText(path)).toBe("profile_id=two\n");
    expect(await pathExists(`${path}.tmp`)).toBe(false);
  });
});
