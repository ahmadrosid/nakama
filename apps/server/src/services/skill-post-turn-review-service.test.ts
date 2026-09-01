import { describe, expect, test } from "bun:test";
import type { ChatMessage, UserConfig } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import {
  evaluatePostTurnReviewTurnEligibility,
  SkillPostTurnReviewService,
} from "./skill-post-turn-review-service";

function toolCall(id: string, name = "read_file") {
  return { arguments: "{}", id, name };
}

function assistantWithTools(count: number, names?: string[]): ChatMessage {
  const toolCalls = Array.from({ length: count }, (_, index) =>
    toolCall(`call_${index}`, names?.[index] ?? "read_file")
  );
  return { content: "working", role: "assistant", toolCalls };
}

async function seedEligibleTurn(db: DatabaseAdapter, channel: string) {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: "org_1",
    name: "Org",
    skillsPostTurnReview: true,
    slug: "org",
    updatedAt: now,
  });
  await db.upsertProfile({
    createdAt: now,
    id: "profile_1",
    isSuper: false,
    model: null,
    name: "Bot",
    orgId: "org_1",
    systemPrompt: "",
    updatedAt: now,
  });
  await db.upsertSkill({
    createdAt: now,
    createdBy: "bundled",
    description: "Manage skills",
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    id: "skill_manage_skills",
    name: "manage-skills",
    sourcePath: "/tmp/manage-skills/SKILL.md",
    updatedAt: now,
  });
  await db.assignSkillToProfile("profile_1", "skill_manage_skills");
  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel,
    createdAt: now,
    id: "session_1",
    model: null,
    orgId: "org_1",
    profileId: "profile_1",
    title: null,
    userId: "user_1",
  });

  const turn: ChatMessage[] = [
    { content: "complex", role: "user" },
    assistantWithTools(5),
    ...Array.from({ length: 5 }, (_, index) => ({
      content: "{}",
      name: "read_file",
      role: "tool" as const,
      toolCallId: `call_${index}`,
    })),
  ];
  await db.appendMessagesForSession(
    "session_1",
    turn.map((message, index) => ({
      createdAt: now,
      id: `msg_${index}`,
      payload: message,
      seq: index,
      sessionId: "session_1",
    }))
  );
}

describe("evaluatePostTurnReviewTurnEligibility", () => {
  test("eligible when turn has 5+ tool calls", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { content: "do the thing", role: "user" },
      assistantWithTools(5),
    ]);
    expect(result.eligible).toBe(true);
    expect(result.toolCallCount).toBe(5);
  });

  test("skips when fewer than 5 tools and no errors", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { content: "simple", role: "user" },
      assistantWithTools(4),
    ]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("turn_not_complex");
  });

  test("eligible when tool error present even with fewer than 5 tools", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { content: "fix it", role: "user" },
      assistantWithTools(1),
      {
        content: JSON.stringify({ error: "not found" }),
        name: "read_file",
        role: "tool",
        toolCallId: "call_0",
      },
    ]);
    expect(result.eligible).toBe(true);
    expect(result.hasToolError).toBe(true);
  });

  test("skips when skill_manage already used this turn", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { content: "save skill", role: "user" },
      assistantWithTools(5, [
        "read_file",
        "read_file",
        "read_file",
        "read_file",
        "skill_manage",
      ]),
    ]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("skill_manage_already_used");
  });
});

describe("SkillPostTurnReviewService", () => {
  test("runs runner once for eligible interactive channels when flag on and manage-skills assigned", async () => {
    for (const channel of ["web", "cli", "discord", "telegram", "whatsapp"]) {
      const db = createInMemoryDatabaseAdapter();
      await seedEligibleTurn(db, channel);

      let ran = 0;
      const service = new SkillPostTurnReviewService(
        db,
        () => null,
        async () => {
          ran += 1;
        }
      );

      expect(await service.runPostTurnSkillReview("session_1")).toBe("ran");
      expect(ran).toBe(1);
    }
  });

  // The other half of the same table. Together these two cover all eight
  // channels, so flipping any value in POST_TURN_REVIEW_CHANNELS fails a test
  // rather than only shifting behaviour.
  test("skips the non-interactive channels even when the turn is eligible", async () => {
    for (const channel of ["automation", "task", "subagent"]) {
      const db = createInMemoryDatabaseAdapter();
      await seedEligibleTurn(db, channel);

      let ran = 0;
      const service = new SkillPostTurnReviewService(
        db,
        () => null,
        async () => {
          ran += 1;
        }
      );

      expect(await service.runPostTurnSkillReview("session_1")).toBe(
        "channel_not_interactive"
      );
      expect(ran).toBe(0);
    }
  });

  test("skips a channel value that is not an agent channel at all", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedEligibleTurn(db, "sms");

    let ran = 0;
    const service = new SkillPostTurnReviewService(
      db,
      () => null,
      async () => {
        ran += 1;
      }
    );

    expect(await service.runPostTurnSkillReview("session_1")).toBe(
      "channel_not_interactive"
    );
    expect(ran).toBe(0);
  });

  test("skips when flag disabled", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_1",
      name: "Org",
      skillsPostTurnReview: false,
      slug: "org",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "profile_1",
      isSuper: false,
      model: null,
      name: "Bot",
      orgId: "org_1",
      systemPrompt: "",
      updatedAt: now,
    });
    await db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_1",
      model: null,
      orgId: "org_1",
      profileId: "profile_1",
      title: null,
      userId: "user_1",
    });

    let ran = 0;
    const service = new SkillPostTurnReviewService(
      db,
      () => null,
      async () => {
        ran += 1;
      }
    );
    expect(await service.runPostTurnSkillReview("session_1")).toBe(
      "flag_disabled"
    );
    expect(ran).toBe(0);
  });

  test("skips duplicate while in flight", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedEligibleTurn(db, "cli");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ran = 0;
    const service = new SkillPostTurnReviewService(
      db,
      () => null,
      async () => {
        ran += 1;
        await gate;
      }
    );

    const first = service.runPostTurnSkillReview("session_1");
    await Promise.resolve();
    expect(await service.runPostTurnSkillReview("session_1")).toBe("in_flight");
    release();
    expect(await first).toBe("ran");
    expect(ran).toBe(1);
  });

  test("resolveProviderForProfile passes the model string to createProvider", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "profile_1",
      isSuper: false,
      model: "openai-1::gpt-5.4",
      name: "Bot",
      orgId: "org_1",
      systemPrompt: "",
      updatedAt: now,
    });

    const userConfig: UserConfig = {
      defaultProviderId: "openai-1",
      providers: [
        {
          apiKey: "sk-test",
          createdAt: now,
          id: "openai-1",
          label: "OpenAI",
          type: "openai",
        },
      ],
    };

    const service = new SkillPostTurnReviewService(db, () => userConfig);
    const provider = await service.resolveProviderForProfile("profile_1");
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("openai");
  });
});
