import { describe, expect, test } from "bun:test";
import type {
  CreateProfileRequest,
  ProfileResponse,
  UpdateProfileRequest,
} from "@nakama/core";
import { z } from "zod";
import type { ProfileService } from "../services/profile-service";
import {
  PROFILE_UPDATE_CONFIRMATION_MESSAGE,
  SuperNakamaSessionState,
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

describe("super nakama create_profile", () => {
  test("resolves provider inheritance and overrides", async () => {
    for (const [, sourceModel, override, expected] of [
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
    ] as const) {
      const source: ProfileResponse = {
        profile: {
          createdAt: "2026-01-01T00:00:00.000Z",
          hasAvatar: false,
          id: "super-nakama",
          isSuper: true,
          mcpServerCount: 0,
          mcpServers: [],
          model: sourceModel,
          name: "Super Nakama",
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
          expect(profileId).toBe("super-nakama");
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
        profileId: "super-nakama",
        sessionId: SESSION_ID,
      });
      expect(lookups).toBe(override === undefined ? 1 : 0);
    }
  });

  test("creates a profile on the first turn", async () => {
    const sessionState = new SuperNakamaSessionState();
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
    const sessionState = new SuperNakamaSessionState();
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

describe("super nakama update_profile", () => {
  test("refuses update_profile on the first turn", async () => {
    let updateProfileCalled = false;
    const sessionState = new SuperNakamaSessionState();
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

    const sessionState = new SuperNakamaSessionState();
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

  test("update_profile can change only the model", async () => {
    const captured: UpdateProfileRequest[] = [];

    const updateProfile = getUpdateProfileTool({
      async updateProfile(
        _orgId: string,
        _profileId: string,
        request: UpdateProfileRequest
      ): Promise<ProfileResponse> {
        captured.push(request);

        return profileResponse({ systemPrompt: "You are support." });
      },
    });

    await updateProfile.run(
      { model: "provider-a::model-a", profileId: "support-bot" },
      { orgId: ORG_ID, sessionId: SESSION_ID }
    );

    expect(captured).toEqual([{ model: "provider-a::model-a" }]);
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

    expect(error?.message).toBe(
      "Provide systemPrompt, soulFiles, and/or model."
    );
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

function getCreateProfileTool(
  profileService: Pick<ProfileService, "createProfile"> &
    Partial<Pick<ProfileService, "getProfile">>,
  sessionState?: SuperNakamaSessionState
) {
  const state = sessionState ?? new SuperNakamaSessionState();

  if (!sessionState) {
    state.beginTurn(SESSION_ID);
    state.beginTurn(SESSION_ID);
  }

  const tool = createSuperNakamaTools(
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
  sessionState?: SuperNakamaSessionState
) {
  const state = sessionState ?? new SuperNakamaSessionState();

  if (!sessionState) {
    state.beginTurn(SESSION_ID);
    state.beginTurn(SESSION_ID);
  }

  const tool = createSuperNakamaTools(
    asProfileService(profileService),
    state
  ).find((candidate) => candidate.name === "update_profile");

  if (!tool) {
    throw new Error("update_profile was not registered");
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

describe("super nakama create_group", () => {
  test("creates the group for the signed-in user with the brief", async () => {
    const calls: unknown[][] = [];

    // SAFETY: create_group never touches the profile service.
    const profileService = {} as ProfileService;

    const tool = createSuperNakamaTools(
      profileService,
      new SuperNakamaSessionState(),
      undefined,
      undefined,
      {
        createGroup: async (...args) => {
          calls.push(args);

          // SAFETY: only the fields the tool returns are read.
          return { id: "g1" } as Awaited<
            ReturnType<
              NonNullable<
                Parameters<typeof createSuperNakamaTools>[4]
              >["createGroup"] & {}
            >
          >;
        },
      }
    ).find((candidate) => candidate.name === "create_group");

    const result = await tool?.run(
      { brief: "Ship v2", memberIds: ["a", "b"], name: "Launch" },
      { orgId: ORG_ID, userId: "u1" }
    );

    expect(calls).toEqual([[ORG_ID, "u1", "Launch", ["a", "b"], "Ship v2"]]);
    expect(result).toMatchObject({ type: "group_created" });
    await expect(
      tool?.run(
        { memberIds: ["a"], name: "Solo" },
        { orgId: ORG_ID, userId: "u1" }
      )
    ).rejects.toThrow();
  });
});
