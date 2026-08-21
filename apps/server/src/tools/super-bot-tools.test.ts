import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CreateProfileRequest,
  CreateToolRequest,
  ProfileResponse,
  ToolDetail,
} from "@nakama/core";
import type { ProfileService } from "../services/profile-service";
import {
  PROFILE_CREATE_CONFIRMATION_MESSAGE,
  SuperBotSessionState,
  TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE,
} from "../services/super-bot-session-state";
import { createSuperBotTools } from "./super-bot-tools";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
const ORG_ID = "org_test";
const SESSION_ID = "session_test";

describe("super bot create_tool", () => {
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

  test("defaults agent-authored tools to javascript when handlerType is omitted", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "tools");
    await mkdir(toolsDir, { recursive: true });

    await writeFile(
      path.join(toolsDir, "echo.js"),
      `export async function run(input) {
  return input;
}
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
          id: "tool_echo",
          name: request.name,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    const result = await createTool.run(
      {
        description: "Echo input",
        handlerConfig: { modulePath: "echo.js" },
        name: "echo",
      },
      { sessionId: SESSION_ID }
    );

    expect(capturedRequests[0]?.name).toBe("echo");
    expect(capturedRequests[0]?.description).toBe("Echo input");
    expect(capturedRequests[0]?.handlerType).toBe("javascript");
    expect(capturedRequests[0]?.handlerConfig).toEqual({
      modulePath: "echo.js",
    });
    expect(result).toEqual({
      tool: {
        createdAt: "2026-01-01T00:00:00.000Z",
        description: "Echo input",
        handlerConfig: { modulePath: "echo.js" },
        handlerType: "javascript",
        id: "tool_echo",
        name: "echo",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  test("registers python tools when handlerType is python", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "tools");
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
      { sessionId: SESSION_ID }
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
    const toolsDir = path.join(tempConfigDir, "tools");
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
        { sessionId: SESSION_ID }
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
        { sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toMatch(/javascript or python/i);
    expect(createToolCalled).toBe(false);
  });

  test("rejects shell wrapper module paths", async () => {
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
          description: "Shell wrapper",
          handlerConfig: { modulePath: "wrapper.sh" },
          handlerType: "javascript",
          name: "wrapper",
        },
        { sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toMatch(/ending in "\.js"/i);
    expect(createToolCalled).toBe(false);
  });

  test("rejects missing javascript modules before storing the tool", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-super-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "tools");
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
        { sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe("Tool module not found: missing.js");
    expect(createToolCalled).toBe(false);
  });
});

describe("super bot assign_tool_to_profile", () => {
  const sessionState = new SuperBotSessionState();

  test("allows the first assignment for a tool created this turn", async () => {
    sessionState.beginTurn(SESSION_ID);
    sessionState.markToolCreated(SESSION_ID, "tool_weather");

    const assignTool = getAssignToolTool(
      {
        async assignTool(
          _orgId: string,
          profileId: string
        ): Promise<ProfileResponse> {
          return {
            profile: {
              createdAt: "2026-01-01T00:00:00.000Z",
              hasAvatar: false,
              id: profileId,
              isSuper: false,
              mcpServerCount: 0,
              mcpServers: [],
              model: null,
              name: "Default Bot",
              skills: [],
              soulActive: false,
              systemPrompt: "You are helpful.",
              toolCount: 1,
              tools: [],
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          };
        },
      },
      sessionState
    );

    await expect(
      assignTool.run(
        { profileId: "default", toolId: "tool_weather" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    ).resolves.toBeDefined();
  });

  test("blocks a second assignment for the same tool in the same turn", async () => {
    sessionState.beginTurn(SESSION_ID);
    sessionState.markToolCreated(SESSION_ID, "tool_weather");
    sessionState.markToolAssigned(SESSION_ID, "tool_weather");

    const assignTool = getAssignToolTool(
      {
        async assignTool(): Promise<ProfileResponse> {
          throw new Error("should not be called");
        },
      },
      sessionState
    );

    const error = await captureError(
      assignTool.run(
        { profileId: "profile_other", toolId: "tool_weather" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe(TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE);
  });

  test("allows another assignment after beginTurn reset", async () => {
    sessionState.beginTurn(SESSION_ID);
    sessionState.markToolCreated(SESSION_ID, "tool_weather");
    sessionState.markToolAssigned(SESSION_ID, "tool_weather");

    sessionState.beginTurn(SESSION_ID);

    let assignCalls = 0;

    const assignTool = getAssignToolTool(
      {
        async assignTool(
          _orgId: string,
          profileId: string
        ): Promise<ProfileResponse> {
          assignCalls += 1;

          return {
            profile: {
              createdAt: "2026-01-01T00:00:00.000Z",
              hasAvatar: false,
              id: profileId,
              isSuper: false,
              mcpServerCount: 0,
              mcpServers: [],
              model: null,
              name: "Other Bot",
              skills: [],
              soulActive: false,
              systemPrompt: "You are helpful.",
              toolCount: 1,
              tools: [],
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          };
        },
      },
      sessionState
    );

    await assignTool.run(
      { profileId: "profile_other", toolId: "tool_weather" },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(assignCalls).toBe(1);
  });
});

describe("super bot create_profile", () => {
  test("refuses create_profile on the first turn", async () => {
    let createProfileCalled = false;
    const sessionState = new SuperBotSessionState();
    sessionState.beginTurn(SESSION_ID);
    const createProfile = getCreateProfileTool(
      {
        async createProfile(): Promise<ProfileResponse> {
          createProfileCalled = true;
          throw new Error("should not be called");
        },
      },
      sessionState
    );

    const error = await captureError(
      createProfile.run(
        { name: "Gary" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe(PROFILE_CREATE_CONFIRMATION_MESSAGE);
    expect(createProfileCalled).toBe(false);
  });

  test("creates after a later user turn confirms the draft", async () => {
    const capturedRequests: CreateProfileRequest[] = [];
    const sessionState = new SuperBotSessionState();
    sessionState.beginTurn(SESSION_ID);
    sessionState.beginTurn(SESSION_ID);
    const createProfile = getCreateProfileTool(
      {
        async createProfile(
          _orgId: string,
          request: CreateProfileRequest
        ): Promise<ProfileResponse> {
          capturedRequests.push(request);
          return {
            profile: {
              createdAt: "2026-01-01T00:00:00.000Z",
              hasAvatar: false,
              id: "gary",
              isSuper: false,
              mcpServerCount: 0,
              mcpServers: [],
              model: null,
              name: request.name,
              skills: [],
              soulActive: true,
              systemPrompt: "",
              toolCount: 0,
              tools: [],
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          };
        },
      },
      sessionState
    );

    await expect(
      createProfile.run(
        { name: "Gary" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    ).resolves.toMatchObject({ profile: { name: "Gary" } });
    expect(capturedRequests[0]?.name).toBe("Gary");
    expect(capturedRequests[0]?.id).toBeUndefined();
  });

  test("passes generated soul files to profile creation", async () => {
    const capturedRequests: CreateProfileRequest[] = [];

    const createProfile = getCreateProfileTool({
      async createProfile(
        _orgId: string,
        request: CreateProfileRequest
      ): Promise<ProfileResponse> {
        capturedRequests.push(request);

        return {
          profile: {
            createdAt: "2026-01-01T00:00:00.000Z",
            hasAvatar: false,
            id: "support-bot",
            isSuper: request.isSuper ?? false,
            mcpServerCount: 0,
            mcpServers: [],
            model: request.model ?? null,
            name: request.name,
            skills: [],
            soulActive: true,
            systemPrompt: request.systemPrompt ?? "",
            toolCount: 0,
            tools: [],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      },
    });

    await createProfile.run(
      {
        name: "Support Bot",
        soulFiles: {
          "INSTRUCTIONS.md": "# Instructions",
          "SOUL.md": "# Support Bot",
          "STYLE.md": "# Style",
        },
      },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(capturedRequests[0]?.id).toBeUndefined();
    expect(capturedRequests[0]?.name).toBe("Support Bot");
    expect(capturedRequests[0]?.systemPrompt).toBeUndefined();
    expect(capturedRequests[0]?.model).toBeUndefined();
    expect(capturedRequests[0]?.isSuper).toBe(false);
    expect(capturedRequests[0]?.soulFiles).toEqual({
      "INSTRUCTIONS.md": "# Instructions",
      "SOUL.md": "# Support Bot",
      "STYLE.md": "# Style",
    });
  });

  test("ignores a client-supplied id so profile ids are server-generated", async () => {
    const capturedRequests: CreateProfileRequest[] = [];

    const createProfile = getCreateProfileTool({
      async createProfile(
        _orgId: string,
        request: CreateProfileRequest
      ): Promise<ProfileResponse> {
        capturedRequests.push(request);

        return {
          profile: {
            createdAt: "2026-01-01T00:00:00.000Z",
            hasAvatar: false,
            id: "support-bot",
            isSuper: request.isSuper ?? false,
            mcpServerCount: 0,
            mcpServers: [],
            model: request.model ?? null,
            name: request.name,
            skills: [],
            soulActive: true,
            systemPrompt: request.systemPrompt ?? "",
            toolCount: 0,
            tools: [],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      },
    });

    expect(createProfile.parameters).toMatchObject({
      additionalProperties: false,
      type: "object",
    });
    expect(
      (createProfile.parameters as { properties?: Record<string, unknown> })
        .properties
    ).not.toHaveProperty("id");

    await createProfile.run(
      {
        id: "8dp3bHu3biH538Z9twIj7",
        name: "Newsletter Manager",
      },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(capturedRequests[0]?.id).toBeUndefined();
    expect(capturedRequests[0]?.name).toBe("Newsletter Manager");
  });

  test("rejects unsupported soul file keys", async () => {
    let createProfileCalled = false;
    const createProfile = getCreateProfileTool({
      async createProfile(): Promise<ProfileResponse> {
        createProfileCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      createProfile.run(
        {
          name: "Bad Bot",
          soulFiles: { "../SOUL.md": "# Bad" },
        },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toMatch(/unsupported soul file/i);
    expect(createProfileCalled).toBe(false);
  });
});

function createTestTools(
  profileService: Partial<
    Pick<ProfileService, "createTool" | "assignTool" | "createProfile">
  >
) {
  const sessionState = new SuperBotSessionState();
  sessionState.beginTurn(SESSION_ID);
  return createSuperBotTools(profileService as ProfileService, sessionState);
}

function getCreateToolTool(profileService: Pick<ProfileService, "createTool">) {
  const tool = createTestTools(profileService).find(
    (candidate) => candidate.name === "create_tool"
  );

  if (!tool) {
    throw new Error("create_tool was not registered");
  }

  return tool;
}

function getCreateProfileTool(
  profileService: Pick<ProfileService, "createProfile">,
  sessionState?: SuperBotSessionState
) {
  const state = sessionState ?? new SuperBotSessionState();
  if (!sessionState) {
    state.beginTurn(SESSION_ID);
    state.beginTurn(SESSION_ID);
  }

  const tool = createSuperBotTools(
    profileService as ProfileService,
    state
  ).find((candidate) => candidate.name === "create_profile");

  if (!tool) {
    throw new Error("create_profile was not registered");
  }

  return tool;
}

function getAssignToolTool(
  profileService: Pick<ProfileService, "assignTool">,
  sessionState: SuperBotSessionState
) {
  const tool = createSuperBotTools(
    profileService as ProfileService,
    sessionState
  ).find((candidate) => candidate.name === "assign_tool_to_profile");

  if (!tool) {
    throw new Error("assign_tool_to_profile was not registered");
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
