import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CreateProfileRequest,
  CreateToolRequest,
  ProfileResponse,
  ToolDetail,
  UpdateProfileRequest,
} from "@nakama/core";
import { runWriteFile } from "@nakama/core";
import { z } from "zod";
import {
  approveToolSetup,
  loadToolApiKey,
  loadToolSetup,
} from "../services/custom-tool-shared";
import type { ProfileService } from "../services/profile-service";
import {
  PROFILE_UPDATE_CONFIRMATION_MESSAGE,
  SuperBotSessionState,
  TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE,
} from "../services/super-bot-session-state";
import { createSuperBotTools } from "./super-bot-tools";

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

interface TestHandlerConfig {
  modulePath: string;
  requiresApiKey?: boolean;
}

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

  test.each([false, true])(
    "approved setup connects and assigns once, with API key: %s",
    async (requiresApiKey) => {
      tempConfigDir = await mkdtemp(
        path.join(os.tmpdir(), "nakama-tool-setup-")
      );
      process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
      const created: CreateToolRequest[] = [];
      const assigned: string[] = [];
      let failAssignment = true;
      let stored: ToolDetail;

      const tools = createSuperBotTools(
        asProfileService({
          async assignTool(orgId: string, profileId: string) {
            expect(orgId).toBe(ORG_ID);

            if (failAssignment) {
              failAssignment = false;
              throw new Error("Temporary assignment failure");
            }

            assigned.push(profileId);
          },
          async createTool(request: CreateToolRequest) {
            created.push(request);
            stored = {
              ...request,
              createdAt: "now",
              handlerConfig: request.handlerConfig ?? {},
              handlerType: "javascript",
              id: "tool_setup_test",
              updatedAt: "now",
            };

            return stored;
          },
          async getProfile() {
            return { profile: { id: "target" } };
          },
          async getTool() {
            return { tool: stored };
          },
        }),
        new SuperBotSessionState()
      );

      const propose = tools.find((tool) => tool.name === "propose_tool")!;
      const create = tools.find((tool) => tool.name === "create_tool")!;
      const context = { orgId: ORG_ID, sessionId: SESSION_ID };

      const proposal = z.object({ setupId: z.string() }).parse(
        await propose.run(
          {
            description: "Echo",
            name: "echo",
            plan: "Return the supplied input.",
            requiresApiKey,
          },
          context
        )
      );

      const input = {
        description: "ignored",
        handlerConfig: {
          modulePath: "echo.js",
          requiresApiKey: !requiresApiKey,
        },
        name: "ignored",
        setupId: proposal.setupId,
      };

      await expect(create.run(input, context)).rejects.toThrow();
      expect(created).toHaveLength(0);

      if (requiresApiKey) {
        await expect(
          approveToolSetup(ORG_ID, proposal.setupId, { profileId: "target" })
        ).rejects.toThrow();
        expect((await loadToolSetup(ORG_ID, proposal.setupId)).status).toBe(
          "pending"
        );
      }

      const approval = await approveToolSetup(ORG_ID, proposal.setupId, {
        apiKey: "private-key",
        profileId: "target",
      });

      expect(JSON.stringify(approval)).not.toContain("private-key");
      await expect(
        create.run(input, { ...context, sessionId: "other" })
      ).rejects.toThrow();
      await expect(
        create.run(input, { ...context, orgId: "other" })
      ).rejects.toThrow();
      await mkdir(path.join(tempConfigDir, "tools"), { recursive: true });
      await writeFile(
        path.join(tempConfigDir, "tools", "echo.js"),
        "export async function run(input) { return input; }"
      );
      await expect(create.run(input, context)).rejects.toThrow(
        "Temporary assignment failure"
      );
      expect((await loadToolSetup(ORG_ID, proposal.setupId)).toolId).toBe(
        "tool_setup_test"
      );
      const result = await create.run(input, context);
      expect(JSON.stringify(result)).not.toContain("private-key");
      expect(created).toHaveLength(1);
      expect(created[0]?.name).toBe("echo");
      expect(created[0]?.handlerConfig).toEqual({
        modulePath: "echo.js",
        requiresApiKey,
      });
      expect(assigned).toEqual(["target"]);
      expect(await loadToolApiKey(ORG_ID, "tool_setup_test")).toBe(
        requiresApiKey ? "private-key" : undefined
      );
      expect(await loadToolApiKey(ORG_ID, proposal.setupId)).toBeUndefined();
      expect((await loadToolSetup(ORG_ID, proposal.setupId)).status).toBe(
        "ready"
      );
      await create.run(input, context);
      expect(created).toHaveLength(1);
      expect(assigned).toHaveLength(1);
    }
  );

  test.each([false, true])(
    "defaults to javascript and returns credential setup when required: %s",
    async (requiresApiKey) => {
      tempConfigDir = await mkdtemp(
        path.join(os.tmpdir(), "nakama-super-tool-")
      );
      process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
      const toolsDir = path.join(tempConfigDir, "tools");
      await runWriteFile(
        {
          content: "export async function run(input) { return input; }",
          path: path.join(toolsDir, "echo.js"),
        },
        { orgId: ORG_ID, profileId: "super_bot" }
      );

      const capturedRequests: CreateToolRequest[] = [];
      const sessionState = new SuperBotSessionState();

      const tools = createSuperBotTools(
        asProfileService({
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
        }),
        sessionState
      );

      const createTool = tools.find((tool) => tool.name === "create_tool");

      if (!createTool) {
        throw new Error("create_tool was not registered");
      }

      const handlerConfig: TestHandlerConfig = {
        modulePath: "echo.js",
      };

      if (requiresApiKey) {
        handlerConfig.requiresApiKey = requiresApiKey;
      }

      const result = await createTool.run(
        {
          description: "Echo input",
          handlerConfig,
          name: "echo",
        },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      );

      expect(capturedRequests[0]?.name).toBe("echo");
      expect(capturedRequests[0]?.description).toBe("Echo input");
      expect(capturedRequests[0]?.handlerType).toBe("javascript");
      expect(capturedRequests[0]?.handlerConfig).toEqual(handlerConfig);

      const expectedResult = {
        tool: {
          createdAt: "2026-01-01T00:00:00.000Z",
          description: "Echo input",
          handlerConfig,
          handlerType: "javascript",
          id: "tool_echo",
          name: "echo",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      };

      if (requiresApiKey) {
        expect(result).toMatchObject({
          orgId: ORG_ID,
          toolId: "tool_echo",
          toolName: "echo",
          type: "tool_credentials_required",
        });
      }

      expect(result).toMatchObject(expectedResult);
    }
  );

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
          return profileResponse({
            id: profileId,
            name: "Default Bot",
            soulActive: false,
            systemPrompt: "You are helpful.",
            toolCount: 1,
          });
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

          return profileResponse({
            id: profileId,
            name: "Other Bot",
            soulActive: false,
            systemPrompt: "You are helpful.",
            toolCount: 1,
          });
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
  test.each([
    [
      "inherits provider and model",
      "provider-a::model-a",
      undefined,
      "provider-a::model-a",
    ],
    ["inherits server default", null, undefined, null],
    [
      "preserves model override",
      "provider-a::model-a",
      "provider-b::model-b",
      "provider-b::model-b",
    ],
    ["preserves explicit server default", "provider-a::model-a", null, null],
  ])("%s", async (_label, sourceModel, override, expected) => {
    const source: ProfileResponse = {
      profile: {
        createdAt: "2026-01-01T00:00:00.000Z",
        hasAvatar: false,
        id: "super-bot",
        isSuper: true,
        mcpServerCount: 0,
        mcpServers: [],
        model: sourceModel,
        name: "Super Bot",
        skills: [],
        soulActive: true,
        systemPrompt: "",
        toolCount: 0,
        tools: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    let lookups = 0;

    const createProfile = getCreateProfileTool({
      async createProfile(orgId, request) {
        expect(orgId).toBe(ORG_ID);
        expect(request.model).toBe(expected);

        return {
          profile: {
            ...source.profile,
            id: "new-bot",
            model: request.model ?? null,
          },
        };
      },
      async getProfile(orgId, profileId) {
        expect(orgId).toBe(ORG_ID);
        expect(profileId).toBe("super-bot");
        lookups++;

        return source;
      },
    });

    const input: TestCreateProfileInput = {
      name: "New Bot",
    };

    if (override !== undefined) {
      input.model = override;
    }

    await createProfile.run(input, {
      orgId: ORG_ID,
      profileId: "super-bot",
      sessionId: SESSION_ID,
    });
    expect(lookups).toBe(override === undefined ? 1 : 0);
  });

  test("creates a profile on the first turn", async () => {
    const sessionState = new SuperBotSessionState();
    sessionState.beginTurn(SESSION_ID);

    const createProfile = getCreateProfileTool(
      {
        async createProfile(
          _orgId: string,
          request: CreateProfileRequest
        ): Promise<ProfileResponse> {
          return profileResponse({
            id: "gary",
            name: request.name,
          });
        },
      },
      sessionState
    );

    await expect(
      createProfile.run(
        { name: "Gary" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    ).resolves.toMatchObject({
      profile: { name: "Gary" },
      type: "profile_created",
    });
  });

  test("creates after a later user turn", async () => {
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

          return profileResponse({
            id: "gary",
            name: request.name,
          });
        },
      },
      sessionState
    );

    await expect(
      createProfile.run(
        { name: "Gary" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    ).resolves.toMatchObject({
      profile: { name: "Gary" },
      type: "profile_created",
    });
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

        return profileResponse({
          isSuper: request.isSuper ?? false,
          model: request.model ?? null,
          name: request.name,
          systemPrompt: request.systemPrompt ?? "",
        });
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

        return profileResponse({
          isSuper: request.isSuper ?? false,
          model: request.model ?? null,
          name: request.name,
          systemPrompt: request.systemPrompt ?? "",
        });
      },
    });

    expect(createProfile.parameters).toMatchObject({
      additionalProperties: false,
      type: "object",
    });

    const parameters = z
      .object({ properties: z.record(z.string(), z.json()).optional() })
      .parse(createProfile.parameters);

    expect(parameters.properties).not.toHaveProperty("id");

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

describe("super bot update_profile", () => {
  test("refuses update_profile on the first turn", async () => {
    let updateProfileCalled = false;
    const sessionState = new SuperBotSessionState();
    sessionState.beginTurn(SESSION_ID);

    const updateProfile = getUpdateProfileTool(
      {
        async updateProfile(): Promise<ProfileResponse> {
          updateProfileCalled = true;
          throw new Error("should not be called");
        },
      },
      sessionState
    );

    const error = await captureError(
      updateProfile.run(
        { profileId: "support-bot", systemPrompt: "You are support." },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe(PROFILE_UPDATE_CONFIRMATION_MESSAGE);
    expect(updateProfileCalled).toBe(false);
  });

  test("updates the stored system prompt after a later user turn confirms", async () => {
    const captured: Array<{
      orgId: string;
      profileId: string;
      request: UpdateProfileRequest;
    }> = [];

    const sessionState = new SuperBotSessionState();
    sessionState.beginTurn(SESSION_ID);
    sessionState.beginTurn(SESSION_ID);

    const updateProfile = getUpdateProfileTool(
      {
        async updateProfile(
          orgId: string,
          profileId: string,
          request: UpdateProfileRequest
        ): Promise<ProfileResponse> {
          captured.push({ orgId, profileId, request });

          return profileResponse({
            id: profileId,
            systemPrompt: request.systemPrompt ?? "",
          });
        },
      },
      sessionState
    );

    await expect(
      updateProfile.run(
        { profileId: "support-bot", systemPrompt: "You are support." },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    ).resolves.toMatchObject({
      profile: { id: "support-bot", systemPrompt: "You are support." },
    });
    expect(captured[0]).toEqual({
      orgId: ORG_ID,
      profileId: "support-bot",
      request: { systemPrompt: "You are support." },
    });
  });

  test("clears the stored system prompt when an empty string is passed", async () => {
    const captured: UpdateProfileRequest[] = [];

    const updateProfile = getUpdateProfileTool({
      async updateProfile(
        _orgId: string,
        _profileId: string,
        request: UpdateProfileRequest
      ): Promise<ProfileResponse> {
        captured.push(request);

        return profileResponse({
          systemPrompt: request.systemPrompt ?? "",
        });
      },
    });

    await updateProfile.run(
      { profileId: "support-bot", systemPrompt: "" },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(captured[0]?.systemPrompt).toBe("");
  });

  test("updates soul files after confirmation", async () => {
    const captured: UpdateProfileRequest[] = [];

    const updateProfile = getUpdateProfileTool({
      async updateProfile(
        _orgId: string,
        _profileId: string,
        request: UpdateProfileRequest
      ): Promise<ProfileResponse> {
        captured.push(request);

        return profileResponse({
          systemPrompt: "You are support.",
        });
      },
    });

    await updateProfile.run(
      {
        profileId: "support-bot",
        soulFiles: {
          "SOUL.md": "# Support Bot\n\nCalm and clear.",
          "STYLE.md": "# Style\n\nBrief.",
        },
      },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(captured[0]).toEqual({
      soulFiles: {
        "SOUL.md": "# Support Bot\n\nCalm and clear.",
        "STYLE.md": "# Style\n\nBrief.",
      },
    });
  });

  test("rejects update_profile with neither systemPrompt nor soulFiles", async () => {
    let updateProfileCalled = false;

    const updateProfile = getUpdateProfileTool({
      async updateProfile(): Promise<ProfileResponse> {
        updateProfileCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      updateProfile.run(
        { profileId: "support-bot" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe("Provide systemPrompt and/or soulFiles.");
    expect(updateProfileCalled).toBe(false);
  });

  test("rejects a missing profileId", async () => {
    let updateProfileCalled = false;

    const updateProfile = getUpdateProfileTool({
      async updateProfile(): Promise<ProfileResponse> {
        updateProfileCalled = true;
        throw new Error("should not be called");
      },
    });

    const error = await captureError(
      updateProfile.run(
        { systemPrompt: "You are support." },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe("profileId is required.");
    expect(updateProfileCalled).toBe(false);
  });
});

function profileResponse(
  overrides: Partial<ProfileResponse["profile"]> = {}
): ProfileResponse {
  return {
    profile: {
      createdAt: "2026-01-01T00:00:00.000Z",
      hasAvatar: false,
      id: "support-bot",
      isSuper: false,
      mcpServerCount: 0,
      mcpServers: [],
      model: null,
      name: "Support Bot",
      skills: [],
      soulActive: true,
      systemPrompt: "",
      toolCount: 0,
      tools: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

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
  const sessionState = new SuperBotSessionState();
  sessionState.beginTurn(SESSION_ID);
  sessionState.beginTurn(SESSION_ID);

  return createSuperBotTools(asProfileService(profileService), sessionState);
}

function getCreateToolTool(
  profileService: Pick<ProfileService, "createTool">,
  sessionState?: SuperBotSessionState
) {
  const tool = (
    sessionState
      ? createSuperBotTools(asProfileService(profileService), sessionState)
      : createTestTools(profileService)
  ).find((candidate) => candidate.name === "create_tool");

  if (!tool) {
    throw new Error("create_tool was not registered");
  }

  return tool;
}

function getCreateProfileTool(
  profileService: Pick<ProfileService, "createProfile"> &
    Partial<Pick<ProfileService, "getProfile">>,
  sessionState?: SuperBotSessionState
) {
  const state = sessionState ?? new SuperBotSessionState();

  if (!sessionState) {
    state.beginTurn(SESSION_ID);
    state.beginTurn(SESSION_ID);
  }

  const tool = createSuperBotTools(
    asProfileService(profileService),
    state
  ).find((candidate) => candidate.name === "create_profile");

  if (!tool) {
    throw new Error("create_profile was not registered");
  }

  return tool;
}

function getUpdateProfileTool(
  profileService: Pick<ProfileService, "updateProfile">,
  sessionState?: SuperBotSessionState
) {
  const state = sessionState ?? new SuperBotSessionState();

  if (!sessionState) {
    state.beginTurn(SESSION_ID);
    state.beginTurn(SESSION_ID);
  }

  const tool = createSuperBotTools(
    asProfileService(profileService),
    state
  ).find((candidate) => candidate.name === "update_profile");

  if (!tool) {
    throw new Error("update_profile was not registered");
  }

  return tool;
}

function getAssignToolTool(
  profileService: Pick<ProfileService, "assignTool">,
  sessionState: SuperBotSessionState
) {
  const tool = createSuperBotTools(
    asProfileService(profileService),
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
