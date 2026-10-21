import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CreateToolRequest, ToolDetail } from "@nakama/core";
import type { ProfileService } from "../services/profile-service";
import { SuperNakamaSessionState } from "../services/super-nakama-session-state";
import { createSuperNakamaTools } from "./super-nakama-tools";

type TestProfileService = Partial<
  Pick<
    ProfileService,
    | "assignTool"
    | "createProfile"
    | "createTool"
    | "getProfile"
    | "getTool"
    | "updateProfile"
  >
>;

interface TestCreateProfileInput {
  model?: string | null;
  name: string;
}

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

const ORG_ID = "org_test";

const SESSION_ID = "session_test";

describe("super nakama create_tool", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  test("registers python tools when handlerType is python", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "orgs", ORG_ID, "tools");
    await mkdir(toolsDir, { recursive: true });

    await writeFile(
      path.join(toolsDir, "echo.py"),
      `import json
import sys

def run(input, context):
    return input

if __name__ == "__main__":
    payload = json.loads(sys.stdin.read() or "{}")
    sys.stdout.write(json.dumps(run(payload, {})))
`,
      "utf8"
    );

    const capturedRequests: CreateToolRequest[] = [];

    const createTool = getCreateToolTool({
      async createTool(request: CreateToolRequest): Promise<ToolDetail> {
        capturedRequests.push(request);

        return {
          createdAt: "2026-01-01T00:00:00.000Z",
          description: request.description,
          handlerConfig: request.handlerConfig ?? {},
          handlerType: request.handlerType ?? "javascript",
          id: "tool_echo_py",
          name: request.name,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    const result = await createTool.run(
      {
        description: "Echo input in Python",
        handlerConfig: { modulePath: "echo.py" },
        handlerType: "python",
        name: "echo_py",
      },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(capturedRequests[0]?.handlerType).toBe("python");
    expect(capturedRequests[0]?.handlerConfig).toEqual({
      modulePath: "echo.py",
    });
    expect(result).toMatchObject({
      tool: {
        handlerType: "python",
        id: "tool_echo_py",
        name: "echo_py",
      },
    });
  });

  test("rejects python tools that lack a stdin/stdout harness", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "orgs", ORG_ID, "tools");
    await mkdir(toolsDir, { recursive: true });

    await writeFile(
      path.join(toolsDir, "noharness.py"),
      `def run(input, context):
    return input
`,
      "utf8"
    );

    let createToolCalled = false;

    const createTool = getCreateToolTool({
      async createTool(): Promise<ToolDetail> {
        createToolCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createTool.run(
        {
          description: "Missing harness",
          handlerConfig: { modulePath: "noharness.py" },
          handlerType: "python",
          name: "noharness",
        },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toMatch(/__main__/i);
    expect(createToolCalled).toBe(false);
  });

  test('rejects handlerType "custom"', async () => {
    let createToolCalled = false;

    const createTool = getCreateToolTool({
      async createTool(): Promise<ToolDetail> {
        createToolCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createTool.run(
        {
          description: "Bad tool",
          handlerConfig: { modulePath: "bad-tool.js" },
          handlerType: "custom",
          name: "bad-tool",
        },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toMatch(/javascript or python/i);
    expect(createToolCalled).toBe(false);
  });

  test("rejects missing javascript modules before storing the tool", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "orgs", ORG_ID, "tools");
    await mkdir(toolsDir, { recursive: true });

    let createToolCalled = false;

    const createTool = getCreateToolTool({
      async createTool(): Promise<ToolDetail> {
        createToolCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createTool.run(
        {
          description: "Missing module",
          handlerConfig: { modulePath: "missing.js" },
          name: "missing",
        },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe("Tool module not found: missing.js");
    expect(createToolCalled).toBe(false);
  });

  test("rejects javascript modules with a syntax error before storing the tool", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "orgs", ORG_ID, "tools");
    await mkdir(toolsDir, { recursive: true });
    await writeFile(
      path.join(toolsDir, "broken.js"),
      "export async function run(input) {\n  const count = ;\n  return count;\n}\n"
    );

    let createToolCalled = false;

    const createTool = getCreateToolTool({
      async createTool(): Promise<ToolDetail> {
        createToolCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createTool.run(
        {
          description: "Broken module",
          handlerConfig: { modulePath: "broken.js" },
          name: "broken",
        },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error).not.toBeNull();
    expect(createToolCalled).toBe(false);
  });
});

function asProfileService(mock: TestProfileService): ProfileService {
  // SAFETY: Each test provides every ProfileService method that its tool path invokes.
  return mock as ProfileService;
}

function createTestTools(
  profileService: Partial<
    Pick<
      ProfileService,
      "createTool" | "assignTool" | "createProfile" | "updateProfile"
    >
  >
) {
  const sessionState = new SuperNakamaSessionState();
  sessionState.beginTurn(SESSION_ID);
  sessionState.beginTurn(SESSION_ID);

  return createSuperNakamaTools(asProfileService(profileService), sessionState);
}

function getCreateToolTool(
  profileService: Pick<ProfileService, "createTool">,
  sessionState?: SuperNakamaSessionState
) {
  const tool = (
    sessionState
      ? createSuperNakamaTools(asProfileService(profileService), sessionState)
      : createTestTools(profileService)
  ).find((candidate) => candidate.name === "create_tool");

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
