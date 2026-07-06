import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { StoredToolRecord } from "@nakama/db";
import {
  loadJavascriptTool,
  resolveJavascriptModulePath,
} from "./javascript-tool-loader";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

async function setupToolsDir(): Promise<{ configDir: string; toolsDir: string }> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "nakama-config-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  const toolsDir = path.join(configDir, "tools");
  await mkdir(toolsDir, { recursive: true });
  return { configDir, toolsDir };
}

describe("javascript tool loader", () => {
  let configDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }
  });

  test("loads a module and runs exported run(input)", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "echo.js"),
      `export const parameters = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
};

export async function run(input) {
  return { echoed: input.message };
}
`,
      "utf8",
    );

    const record: StoredToolRecord = {
      id: "tool_echo",
      name: "echo",
      description: "Echo a message",
      handlerType: "javascript",
      handlerConfig: { modulePath: "echo.js" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const tool = await loadJavascriptTool(record);

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("echo");
    expect(tool?.parameters?.required).toEqual(["message"]);

    const result = await tool!.run({ message: "hello" }, {});
    expect(result).toEqual({ echoed: "hello" });
  });

  test("rejects module paths outside the tools directory", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;

    expect(() => resolveJavascriptModulePath("../escape.js")).toThrow(
      /must stay inside/i,
    );
  });

  test("returns an error tool when the module file is missing", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;

    const record: StoredToolRecord = {
      id: "tool_missing",
      name: "missing",
      description: "Missing module",
      handlerType: "javascript",
      handlerConfig: { modulePath: "missing.js" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const tool = await loadJavascriptTool(record);
    const result = await tool!.run({}, {});

    expect(result).toEqual({ error: "Tool module not found: missing.js" });
  });
});

describe("tool resolver", () => {
  let configDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
      configDir = "";
    }
  });

  test("resolves javascript tools from storage", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "adder.js"),
      `export async function run(input) {
  return { sum: Number(input.a) + Number(input.b) };
}
`,
      "utf8",
    );

    const { resolveToolsFromStorage } = await import("./tool-resolver");
    const tools = await resolveToolsFromStorage([
      {
        id: "tool_adder",
        name: "adder",
        description: "Add two numbers",
        handlerType: "javascript",
        handlerConfig: { modulePath: "adder.js" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(await tools[0]!.run({ a: 2, b: 3 }, {})).toEqual({ sum: 5 });
  });

  test("skips unsupported handler types", async () => {
    const { resolveToolsFromStorage } = await import("./tool-resolver");
    const tools = await resolveToolsFromStorage([
      {
        id: "tool_legacy_custom",
        name: "legacy-custom",
        description: "Unsupported tool",
        handlerType: "custom",
        handlerConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(tools).toHaveLength(0);
  });
});
