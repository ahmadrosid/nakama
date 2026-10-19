import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CreateToolRequest,
  ProfileResponse,
  ToolDetail,
} from "@nakama/core";
import { runWriteFile } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import {
  approveToolSetup,
  loadToolApiKey,
  loadToolSetup,
  saveToolSetup,
  setToolSecrets,
} from "../services/custom-tool-shared";
import { ManagedSecrets } from "../services/managed-secrets";
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

interface TestHandlerConfig {
  modulePath: string;
  requiresApiKey?: boolean;
}

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

const ORG_ID = "org_test";

const SESSION_ID = "session_test";

describe("super nakama create_tool", () => {
  setToolSecrets(
    new ManagedSecrets(
      createInMemoryDatabaseAdapter(),
      Buffer.alloc(32, 1).toString("base64")
    )
  );
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

      const tools = createSuperNakamaTools(
        asProfileService({
          async assignTool(orgId: string, profileId: string) {
            expect(orgId).toBe(ORG_ID);

            if (failAssignment) {
              failAssignment = false;
              throw new Error("Temporary assignment failure");
            }

            assigned.push(profileId);

            return profileResponse({ id: profileId });
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
            return profileResponse({ id: "target" });
          },
          async getTool(toolId, orgId) {
            expect(toolId).toBe("tool_setup_test");
            expect(orgId).toBe(ORG_ID);

            return { tool: stored };
          },
        }),
        new SuperNakamaSessionState()
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
      await mkdir(path.join(tempConfigDir, "orgs", ORG_ID, "tools"), {
        recursive: true,
      });
      await writeFile(
        path.join(tempConfigDir, "orgs", ORG_ID, "tools", "echo.js"),
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

  test("setup retry rejects an unavailable tool before moving its key", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-tool-setup-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const setupId = crypto.randomUUID();
    await saveToolSetup(ORG_ID, {
      description: "Parent tool",
      id: setupId,
      name: "parent_tool",
      plan: "Read provider data",
      requiresApiKey: true,
      sessionId: SESSION_ID,
      status: "pending",
      toolId: "parent_tool_id",
    });
    await approveToolSetup(ORG_ID, setupId, { apiKey: "team-key" });
    await mkdir(path.join(tempConfigDir, "orgs", ORG_ID, "tools"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempConfigDir, "orgs", ORG_ID, "tools", "echo.js"),
      "export async function run(input) { return input; }"
    );
    let reads = 0;

    const tools = createSuperNakamaTools(
      asProfileService({
        async getTool(toolId, orgId) {
          reads += 1;
          expect(toolId).toBe("parent_tool_id");
          expect(orgId).toBe(ORG_ID);
          throw new Error("Tool unavailable");
        },
      }),
      new SuperNakamaSessionState()
    );

    const create = tools.find((tool) => tool.name === "create_tool")!;
    await expect(
      create.run(
        { handlerConfig: { modulePath: "echo.js" }, setupId },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    ).rejects.toThrow();
    expect(reads).toBe(1);
    expect((await loadToolSetup(ORG_ID, setupId)).status).toBe("approved");
    expect(await loadToolApiKey(ORG_ID, setupId)).toBe("team-key");
    expect(await loadToolApiKey(ORG_ID, "parent_tool_id")).toBeUndefined();
    expect(
      await loadToolApiKey("parent_org", "parent_tool_id")
    ).toBeUndefined();
  });

  test.each([false, true])(
    "defaults to javascript and returns credential setup when required: %s",
    async (requiresApiKey) => {
      tempConfigDir = await mkdtemp(
        path.join(os.tmpdir(), "nakama-super-tool-")
      );
      process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
      const toolsDir = path.join(tempConfigDir, "orgs", ORG_ID, "tools");
      await runWriteFile(
        {
          content: "export async function run(input) { return input; }",
          path: path.join(toolsDir, "echo.js"),
        },
        { orgId: ORG_ID, profileId: "super_nakama" }
      );

      const capturedRequests: CreateToolRequest[] = [];
      const sessionState = new SuperNakamaSessionState();

      const tools = createSuperNakamaTools(
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
