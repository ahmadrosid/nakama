import { describe, expect, test } from "bun:test";
import type {
  AssignSkillRequest,
  ListSkillsResponse,
  ModelsResponse,
  ProfileResponse,
} from "@nakama/core";
import type { ProfileService } from "../services/profile-service";
import {
  SKILL_ASSIGNMENT_CONFIRMATION_MESSAGE,
  SuperNakamaSessionState,
  TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE,
} from "../services/super-nakama-session-state";
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

describe("super nakama assign_tool_to_profile", () => {
  const sessionState = new SuperNakamaSessionState();

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

describe("super nakama list_models", () => {
  test("returns profile model ids with vision support and no secrets", async () => {
    const models: ModelsResponse = {
      currentProviderId: "prov_main",
      displayName: null,
      models: [
        {
          default: true,
          id: "text-model",
          name: "Text Model",
          provider: "openai_compatible",
          providerId: "prov_main",
        },
        {
          id: "vision-model",
          name: "Vision Model",
          provider: "openai_compatible",
          providerId: "prov_main",
        },
      ],
      provider: "openai_compatible",
      providers: [
        {
          // A leaked secret on the summary must not reach the tool result.
          ...{ apiKey: "sk-secret-value" },
          createdAt: "2026-01-01T00:00:00.000Z",
          customModels: [
            { default: true, id: "text-model", supportsVision: false },
            { id: "vision-model", supportsVision: true },
          ],
          hasApiKey: true,
          id: "prov_main",
          label: "Main",
          modelCount: 2,
          type: "openai_compatible",
        },
      ],
    };

    const tool = findTool(
      createSuperNakamaTools(
        asProfileService({
          async getProfile() {
            return profileResponse({ id: "super", model: null });
          },
        }),
        new SuperNakamaSessionState(),
        async () => "prov_main::text-model",
        undefined,
        { getModels: async () => models }
      ),
      "list_models"
    );

    const result = await tool.run(
      {},
      { orgId: ORG_ID, profileId: "super", sessionId: SESSION_ID }
    );

    expect(result).toEqual({
      defaultProviderId: "prov_main",
      inheritedModel: "prov_main::text-model",
      providers: [
        {
          default: true,
          id: "prov_main",
          label: "Main",
          models: [
            {
              default: true,
              id: "prov_main::text-model",
              name: "Text Model",
              supportsVision: false,
            },
            {
              default: false,
              id: "prov_main::vision-model",
              name: "Vision Model",
              supportsVision: true,
            },
          ],
          type: "openai_compatible",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sk-secret-value");
  });
});

describe("super nakama assign_skill_to_profile", () => {
  const skills: ListSkillsResponse = {
    skills: [
      skillSummary({ id: "skill_ledger", name: "use-finance-ledger" }),
      skillSummary({ id: "skill_dup_a", name: "duplicate" }),
      skillSummary({ id: "skill_dup_b", name: "duplicate" }),
    ],
  };

  function setup(turns: number) {
    const sessionState = new SuperNakamaSessionState();

    for (let index = 0; index < turns; index += 1) {
      sessionState.beginTurn(SESSION_ID);
    }

    const calls: { orgId: string; profileId: string; skillId: string }[] = [];
    const listedOrgs: string[] = [];

    const tool = findTool(
      createSuperNakamaTools(
        asProfileService({}),
        sessionState,
        undefined,
        undefined,
        {
          async assignSkill(
            orgId: string,
            profileId: string,
            request: AssignSkillRequest
          ) {
            calls.push({ orgId, profileId, skillId: request.skillId });

            return profileResponse({ id: profileId });
          },
          async listSkills(orgId: string) {
            listedOrgs.push(orgId);

            return skills;
          },
        }
      ),
      "assign_skill_to_profile"
    );

    return { calls, listedOrgs, tool };
  }

  test("assigns a skill by name within the active org after approval", async () => {
    const { calls, listedOrgs, tool } = setup(2);

    await tool.run(
      { profileId: "finance", skill: "use-finance-ledger" },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(listedOrgs).toEqual([ORG_ID]);
    expect(calls).toEqual([
      { orgId: ORG_ID, profileId: "finance", skillId: "skill_ledger" },
    ]);
  });

  test("assigns a skill by id", async () => {
    const { calls, tool } = setup(2);

    await tool.run(
      { profileId: "finance", skill: "skill_dup_b" },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(calls.map((call) => call.skillId)).toEqual(["skill_dup_b"]);
  });

  test("refuses on the first turn before the user approves", async () => {
    const { calls, tool } = setup(1);

    const error = await captureError(
      tool.run(
        { profileId: "finance", skill: "use-finance-ledger" },
        { orgId: ORG_ID, sessionId: SESSION_ID }
      )
    );

    expect(error?.message).toBe(SKILL_ASSIGNMENT_CONFIRMATION_MESSAGE);
    expect(calls).toEqual([]);
  });

  test("requires an organization", async () => {
    const { calls, tool } = setup(2);

    const error = await captureError(
      tool.run(
        { profileId: "finance", skill: "use-finance-ledger" },
        { sessionId: SESSION_ID }
      )
    );

    expect(error).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test("does not assign an unknown or ambiguous skill name", async () => {
    const { calls, tool } = setup(2);

    for (const skill of ["missing-skill", "duplicate"]) {
      const error = await captureError(
        tool.run(
          { profileId: "finance", skill },
          { orgId: ORG_ID, sessionId: SESSION_ID }
        )
      );

      expect(error).not.toBeNull();
    }

    expect(calls).toEqual([]);
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

function getAssignToolTool(
  profileService: Pick<ProfileService, "assignTool">,
  sessionState: SuperNakamaSessionState
) {
  const tool = createSuperNakamaTools(
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

function findTool(
  tools: ReturnType<typeof createSuperNakamaTools>,
  name: string
) {
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) {
    throw new Error(`${name} was not registered`);
  }

  return tool;
}

function skillSummary(
  overrides: Pick<ListSkillsResponse["skills"][number], "id" | "name">
): ListSkillsResponse["skills"][number] {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "human",
    description: "",
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    orgId: ORG_ID,
    sourcePath: `skills/${overrides.name}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
