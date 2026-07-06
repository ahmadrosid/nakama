import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type {
  CreateProfileRequest,
  CreateToolRequest,
  ProfileResponse,
  ToolDetail,
} from "@nakama/core";
import type { ProfileService } from "../services/profile-service";
import {
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
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("always registers agent-authored tools as javascript", async () => {
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
      "utf8",
    );

    const capturedRequests: CreateToolRequest[] = [];

    const createTool = getCreateToolTool({
      async createTool(request: CreateToolRequest): Promise<ToolDetail> {
        capturedRequests.push(request);

        return {
          id: "tool_echo",
          name: request.name,
          description: request.description,
          handlerType: request.handlerType ?? "javascript",
          handlerConfig: request.handlerConfig ?? {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    const result = await createTool.run(
      {
        name: "echo",
        description: "Echo input",
        handlerConfig: { modulePath: "echo.js" },
      },
      { sessionId: SESSION_ID },
    );

    expect(capturedRequests[0]?.name).toBe("echo");
    expect(capturedRequests[0]?.description).toBe("Echo input");
    expect(capturedRequests[0]?.handlerType).toBe("javascript");
    expect(capturedRequests[0]?.handlerConfig).toEqual({ modulePath: "echo.js" });
    expect(result).toEqual({
      tool: {
        id: "tool_echo",
        name: "echo",
        description: "Echo input",
        handlerType: "javascript",
        handlerConfig: { modulePath: "echo.js" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
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
          name: "bad-tool",
          description: "Bad tool",
          handlerType: "custom",
          handlerConfig: { modulePath: "bad-tool.js" },
        },
        { sessionId: SESSION_ID },
      ),
    );

    expect(error?.message).toMatch(/only create javascript tools/i);
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
          name: "missing",
          description: "Missing module",
          handlerConfig: { modulePath: "missing.js" },
        },
        { sessionId: SESSION_ID },
      ),
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
        async assignTool(_orgId: string, profileId: string): Promise<ProfileResponse> {
          return {
            profile: {
              id: profileId,
              name: "Default Bot",
              model: null,
              isSuper: false,
              toolCount: 1,
              mcpServerCount: 0,
              soulActive: false,
              hasAvatar: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              systemPrompt: "You are helpful.",
              tools: [],
              mcpServers: [],
              skills: [],
            },
          };
        },
      },
      sessionState,
    );

    await expect(
      assignTool.run(
        { profileId: "default", toolId: "tool_weather" },
        { sessionId: SESSION_ID, orgId: ORG_ID },
      ),
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
      sessionState,
    );

    const error = await captureError(
      assignTool.run(
        { profileId: "profile_other", toolId: "tool_weather" },
        { sessionId: SESSION_ID, orgId: ORG_ID },
      ),
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
        async assignTool(_orgId: string, profileId: string): Promise<ProfileResponse> {
          assignCalls += 1;

          return {
            profile: {
              id: profileId,
              name: "Other Bot",
              model: null,
              isSuper: false,
              toolCount: 1,
              mcpServerCount: 0,
              soulActive: false,
              hasAvatar: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              systemPrompt: "You are helpful.",
              tools: [],
              mcpServers: [],
              skills: [],
            },
          };
        },
      },
      sessionState,
    );

    await assignTool.run(
      { profileId: "profile_other", toolId: "tool_weather" },
      { sessionId: SESSION_ID, orgId: ORG_ID },
    );

    expect(assignCalls).toBe(1);
  });
});

describe("super bot create_profile", () => {
  test("passes generated soul files to profile creation", async () => {
    const capturedRequests: CreateProfileRequest[] = [];

    const createProfile = getCreateProfileTool({
      async createProfile(_orgId: string, request: CreateProfileRequest): Promise<ProfileResponse> {
        capturedRequests.push(request);

        return {
          profile: {
            id: "support-bot",
            name: request.name,
            model: request.model ?? null,
            isSuper: request.isSuper ?? false,
            toolCount: 0,
            mcpServerCount: 0,
            soulActive: true,
            hasAvatar: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            systemPrompt: request.systemPrompt ?? "",
            tools: [],
            mcpServers: [],
            skills: [],
          },
        };
      },
    });

    await createProfile.run(
      {
        name: "Support Bot",
        soulFiles: {
          "SOUL.md": "# Support Bot",
          "STYLE.md": "# Style",
          "INSTRUCTIONS.md": "# Instructions",
        },
      },
      { sessionId: SESSION_ID, orgId: ORG_ID },
    );

    expect(capturedRequests[0]?.id).toBeUndefined();
    expect(capturedRequests[0]?.name).toBe("Support Bot");
    expect(capturedRequests[0]?.systemPrompt).toBeUndefined();
    expect(capturedRequests[0]?.model).toBeUndefined();
    expect(capturedRequests[0]?.isSuper).toBe(false);
    expect(capturedRequests[0]?.soulFiles).toEqual({
      "SOUL.md": "# Support Bot",
      "STYLE.md": "# Style",
      "INSTRUCTIONS.md": "# Instructions",
    });
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
        { sessionId: SESSION_ID, orgId: ORG_ID },
      ),
    );

    expect(error?.message).toMatch(/unsupported soul file/i);
    expect(createProfileCalled).toBe(false);
  });
});

function createTestTools(
  profileService: Partial<Pick<ProfileService, "createTool" | "assignTool" | "createProfile">>,
) {
  const sessionState = new SuperBotSessionState();
  sessionState.beginTurn(SESSION_ID);
  return createSuperBotTools(profileService as ProfileService, sessionState);
}

function getCreateToolTool(profileService: Pick<ProfileService, "createTool">) {
  const tool = createTestTools(profileService).find(
    (candidate) => candidate.name === "create_tool",
  );

  if (!tool) {
    throw new Error("create_tool was not registered");
  }

  return tool;
}

function getCreateProfileTool(profileService: Pick<ProfileService, "createProfile">) {
  const tool = createTestTools(profileService).find(
    (candidate) => candidate.name === "create_profile",
  );

  if (!tool) {
    throw new Error("create_profile was not registered");
  }

  return tool;
}

function getAssignToolTool(
  profileService: Pick<ProfileService, "assignTool">,
  sessionState: SuperBotSessionState,
) {
  const tool = createSuperBotTools(profileService as ProfileService, sessionState).find(
    (candidate) => candidate.name === "assign_tool_to_profile",
  );

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
