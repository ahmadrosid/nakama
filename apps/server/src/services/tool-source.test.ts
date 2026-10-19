import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASH_TOOL_ID, BUILTIN_TOOL_IDS } from "@nakama/core/tools/protected";
import { readToolSource } from "./tool-source";

describe("readToolSource", () => {
  let configDir: string;
  let toolsDir: string;
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  beforeEach(async () => {
    configDir = path.join(import.meta.dir, ".test-config");
    toolsDir = path.join(configDir, "tools");
    await rm(configDir, { force: true, recursive: true });
    await mkdir(toolsDir, { recursive: true });
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }

    await rm(configDir, { force: true, recursive: true });
  });

  test("reads javascript tool modules from the tools directory", async () => {
    await writeFile(
      path.join(toolsDir, "echo.js"),
      'export async function run() { return "ok"; }',
      "utf8"
    );

    const source = await readToolSource({
      createdAt: new Date().toISOString(),
      description: "Echo",
      handlerConfig: { modulePath: "echo.js" },
      handlerType: "javascript",
      id: "tool_echo",
      name: "echo",
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("echo.js");
    expect(source.language).toBe("javascript");
    expect(source.content).toContain('return "ok"');
  });

  test("reads python tool modules from the tools directory", async () => {
    await writeFile(
      path.join(toolsDir, "echo.py"),
      'def run(input, context):\n    return {"ok": True}\n',
      "utf8"
    );

    const source = await readToolSource({
      createdAt: new Date().toISOString(),
      description: "Echo",
      handlerConfig: { modulePath: "echo.py" },
      handlerType: "python",
      id: "tool_echo_py",
      name: "echo_py",
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("echo.py");
    expect(source.language).toBe("python");
    expect(source.content).toContain("def run");
  });

  test("reads built-in file tool source", async () => {
    for (const [name, id, implementation] of [
      ["write_file", BUILTIN_TOOL_IDS.write_file, "writeFileTool"],
      ["edit_file", BUILTIN_TOOL_IDS.edit_file, "editFileTool"],
      ["read_file", BUILTIN_TOOL_IDS.read_file, "readFileTool"],
    ] as const) {
      const source = await readToolSource({
        createdAt: new Date().toISOString(),
        description: name,
        handlerConfig: { name },
        handlerType: "builtin",
        id,
        name,
        updatedAt: new Date().toISOString(),
      });

      expect(source.path).toBe("packages/core/src/tools/builtin.ts");
      expect(source.language).toBe("typescript");
      expect(source.content).toContain(implementation);
    }
  });

  test("rejects unmapped built-in names", async () => {
    for (const name of [
      "missing_tool",
      "toString",
      "constructor",
      "__proto__",
    ]) {
      await expect(
        readToolSource({
          createdAt: new Date().toISOString(),
          description: "Unmapped tool",
          handlerConfig: {},
          handlerType: "builtin",
          id: "tool_unmapped",
          name,
          updatedAt: new Date().toISOString(),
        })
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  test("reads bash tool source", async () => {
    const source = await readToolSource({
      createdAt: new Date().toISOString(),
      description: "Bash",
      handlerConfig: {},
      handlerType: "bash",
      id: BASH_TOOL_ID,
      name: "bash",
      updatedAt: new Date().toISOString(),
    });

    expect(source.path).toBe("apps/server/src/tools/bash.ts");
    expect(source.language).toBe("typescript");
    expect(source.content.length).toBeGreaterThan(0);
  });
});
