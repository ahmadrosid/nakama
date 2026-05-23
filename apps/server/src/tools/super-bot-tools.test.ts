import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CreateToolRequest, ToolSummary } from "@tinyclaw/core";
import type { ProfileService } from "../services/profile-service";
import { createSuperBotTools } from "./super-bot-tools";

const originalToolsDir = process.env.TINYCLAW_TOOLS_DIR;

describe("super bot create_tool", () => {
  let tempToolsDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_TOOLS_DIR = originalToolsDir;

    if (tempToolsDir) {
      await rm(tempToolsDir, { recursive: true, force: true });
      tempToolsDir = "";
    }
  });

  test("always registers agent-authored tools as javascript", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-super-tool-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

    await writeFile(
      path.join(tempToolsDir, "echo.js"),
      `export async function run(input) {
  return input;
}
`,
      "utf8",
    );

    let capturedRequest: CreateToolRequest | null = null;

    const createTool = getCreateToolTool({
      async createTool(request: CreateToolRequest): Promise<ToolSummary> {
        capturedRequest = request;

        return {
          id: "tool_echo",
          name: request.name,
          description: request.description,
          handlerType: request.handlerType ?? "javascript",
        };
      },
    });

    const result = await createTool.run({
      name: "echo",
      description: "Echo input",
      handlerConfig: { modulePath: "echo.js" },
    });

    expect(capturedRequest).toEqual({
      name: "echo",
      description: "Echo input",
      handlerType: "javascript",
      handlerConfig: { modulePath: "echo.js" },
    });
    expect(result).toEqual({
      tool: {
        id: "tool_echo",
        name: "echo",
        description: "Echo input",
        handlerType: "javascript",
      },
    });
  });

  test('rejects handlerType "custom"', async () => {
    let createToolCalled = false;

    const createTool = getCreateToolTool({
      async createTool(): Promise<ToolSummary> {
        createToolCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createTool.run({
        name: "bad-tool",
        description: "Bad tool",
        handlerType: "custom",
        handlerConfig: { modulePath: "bad-tool.js" },
      }),
    );

    expect(error?.message).toMatch(/only create javascript tools/i);
    expect(createToolCalled).toBe(false);
  });

  test("rejects missing javascript modules before storing the tool", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-super-tool-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

    let createToolCalled = false;

    const createTool = getCreateToolTool({
      async createTool(): Promise<ToolSummary> {
        createToolCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createTool.run({
        name: "missing",
        description: "Missing module",
        handlerConfig: { modulePath: "missing.js" },
      }),
    );

    expect(error?.message).toBe("Tool module not found: missing.js");
    expect(createToolCalled).toBe(false);
  });
});

function getCreateToolTool(profileService: Pick<ProfileService, "createTool">) {
  const tool = createSuperBotTools(profileService as ProfileService).find(
    (candidate) => candidate.name === "create_tool",
  );

  if (!tool) {
    throw new Error("create_tool was not registered");
  }

  return tool;
}

async function captureError(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
