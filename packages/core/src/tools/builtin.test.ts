import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { deleteFileTool, writeFileTool } from "./builtin";

describe("file builtin tools", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("write_file creates nested files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-write-"));
    const targetPath = path.join(tempDir, "nested", "hello.txt");

    const result = await writeFileTool.run(
      { path: targetPath, content: "hello world" },
      {},
    );

    expect(result.path).toBe(targetPath);
    expect(result.bytesWritten).toBe(11);
    expect(await readFile(targetPath, "utf8")).toBe("hello world");
  });

  test("write_file resolves relative paths from cwd", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-write-"));
    const result = await writeFileTool.run(
      { path: "notes.txt", content: "relative", cwd: tempDir },
      {},
    );

    expect(result.path).toBe(path.join(tempDir, "notes.txt"));
    expect(await readFile(result.path, "utf8")).toBe("relative");
  });

  test("delete_file removes a file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-delete-"));
    const targetPath = path.join(tempDir, "remove-me.txt");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFileTool.run({ path: targetPath, content: "temp" }, {});

    const result = await deleteFileTool.run({ path: targetPath }, {});

    expect(result).toEqual({ path: targetPath, deleted: true });
    await expect(readFile(targetPath, "utf8")).rejects.toThrow();
  });
});
