import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { StoredToolRecord } from "@tinyclaw/db";
import {
  loadJavascriptTool,
  resolveJavascriptModulePath,
} from "./javascript-tool-loader";

const originalToolsDir = process.env.TINYCLAW_TOOLS_DIR;

describe("javascript tool loader", () => {
  let tempToolsDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_TOOLS_DIR = originalToolsDir;

    if (tempToolsDir) {
      await rm(tempToolsDir, { recursive: true, force: true });
      tempToolsDir = "";
    }
  });

  test("loads a module and runs exported run(input)", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-js-tool-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

    await writeFile(
      path.join(tempToolsDir, "echo.js"),
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

  test("rejects module paths outside the tools directory", () => {
    tempToolsDir = path.join(os.tmpdir(), "tinyclaw-js-tool-guard");
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;

    expect(() => resolveJavascriptModulePath("../escape.js")).toThrow(
      /must stay inside/i,
    );
  });

  test("returns an error tool when the module file is missing", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-js-tool-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

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
  let tempToolsDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_TOOLS_DIR = originalToolsDir;

    if (tempToolsDir) {
      await rm(tempToolsDir, { recursive: true, force: true });
      tempToolsDir = "";
    }
  });

  test("resolves javascript tools from storage", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-resolver-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

    await writeFile(
      path.join(tempToolsDir, "adder.js"),
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
