import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASH_TOOL_ID, BUILTIN_TOOL_IDS } from "@nakama/core/tools/protected";
import type { StoredToolRecord } from "@nakama/db";
import { readToolSource } from "./tool-source";

describe("readToolSource", () => {
  let configDir: string;
  let toolsDir: string;
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  beforeEach(async () => {
    configDir = path.join(import.meta.dir, ".test-config");
    toolsDir = path.join(configDir, "tools");
    await rm(configDir, { recursive: true, force: true });
    await mkdir(toolsDir, { recursive: true });
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }

    await rm(configDir, { recursive: true, force: true });
  });

  test("reads javascript tool modules from the tools directory", async () => {
    await writeFile(
      path.join(toolsDir, "echo.js"),
      'export async function run() { return "ok"; }',
      "utf8",
    );

    const source = await readToolSource({
      id: "tool_echo",
      name: "echo",
      description: "Echo",
      handlerType: "javascript",
      handlerConfig: { modulePath: "echo.js" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("echo.js");
    expect(source.language).toBe("javascript");
    expect(source.content).toContain('return "ok"');
  });

  test("reads built-in write_file source", async () => {
    const source = await readToolSource({
      id: BUILTIN_TOOL_IDS.write_file,
      name: "write_file",
      description: "Write file",
      handlerType: "builtin",
      handlerConfig: { name: "write_file" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("packages/core/src/tools/builtin.ts");
    expect(source.language).toBe("typescript");
    expect(source.content).toContain("writeFileTool");
  });

  test("reads built-in edit_file source", async () => {
    const source = await readToolSource({
      id: BUILTIN_TOOL_IDS.edit_file,
      name: "edit_file",
      description: "Edit file",
      handlerType: "builtin",
      handlerConfig: { name: "edit_file" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("packages/core/src/tools/builtin.ts");
    expect(source.language).toBe("typescript");
    expect(source.content).toContain("editFileTool");
  });

  test("reads built-in read_file source", async () => {
    const source = await readToolSource({
      id: BUILTIN_TOOL_IDS.read_file,
      name: "read_file",
      description: "Read file",
      handlerType: "builtin",
      handlerConfig: { name: "read_file" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("packages/core/src/tools/builtin.ts");
    expect(source.language).toBe("typescript");
    expect(source.content).toContain("readFileTool");
  });

  test("reads bash tool source", async () => {
    const source = await readToolSource({
      id: BASH_TOOL_ID,
      name: "bash",
      description: "Bash",
      handlerType: "bash",
      handlerConfig: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("apps/server/src/tools/bash.ts");
    expect(source.language).toBe("typescript");
    expect(source.content.length).toBeGreaterThan(0);
  });
});
