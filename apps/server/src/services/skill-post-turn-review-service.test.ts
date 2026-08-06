import { describe, expect, test } from "bun:test";
import type { ChatMessage, UserConfig } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  evaluatePostTurnReviewTurnEligibility,
  SkillPostTurnReviewService,
} from "./skill-post-turn-review-service";

function toolCall(id: string, name = "read_file") {
  return { id, name, arguments: "{}" };
}

function assistantWithTools(count: number, names?: string[]): ChatMessage {
  const toolCalls = Array.from({ length: count }, (_, index) =>
    toolCall(`call_${index}`, names?.[index] ?? "read_file"),
  );
  return { role: "assistant", content: "working", toolCalls };
}

describe("evaluatePostTurnReviewTurnEligibility", () => {
  test("eligible when turn has 5+ tool calls", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { role: "user", content: "do the thing" },
      assistantWithTools(5),
    ]);
    expect(result.eligible).toBe(true);
    expect(result.toolCallCount).toBe(5);
  });

  test("skips when fewer than 5 tools and no errors", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { role: "user", content: "simple" },
      assistantWithTools(4),
    ]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("turn_not_complex");
  });

  test("eligible when tool error present even with fewer than 5 tools", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { role: "user", content: "fix it" },
      assistantWithTools(1),
      {
        role: "tool",
        toolCallId: "call_0",
        name: "read_file",
        content: JSON.stringify({ error: "not found" }),
      },
    ]);
    expect(result.eligible).toBe(true);
    expect(result.hasToolError).toBe(true);
  });

  test("skips when skill_manage already used this turn", () => {
    const result = evaluatePostTurnReviewTurnEligibility([
      { role: "user", content: "save skill" },
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
  test("runs runner once for eligible web turn when flag on and manage-skills assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      id: "org_1",
      name: "Org",
      slug: "org",
      skillsPostTurnReview: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertProfile({
      id: "profile_1",
      name: "Bot",
      systemPrompt: "",
      model: null,
      isSuper: false,
      orgId: "org_1",
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertSkill({
      id: "skill_manage_skills",
      name: "manage-skills",
      description: "Manage skills",
      sourcePath: "/tmp/manage-skills/SKILL.md",
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdBy: "bundled",
      createdAt: now,
      updatedAt: now,
    });
    await db.assignSkillToProfile("profile_1", "skill_manage_skills");
    await db.upsertSession({
      id: "session_1",
      profileId: "profile_1",
      channel: "web",
      orgId: "org_1",
      userId: "user_1",
      createdAt: now,
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });

    const turn: ChatMessage[] = [
      { role: "user", content: "complex" },
      assistantWithTools(5),
      ...Array.from({ length: 5 }, (_, index) => ({
        role: "tool" as const,
        toolCallId: `call_${index}`,
        name: "read_file",
        content: "{}",
      })),
    ];
    await db.appendMessagesForSession(
      "session_1",
      turn.map((message, index) => ({
        id: `msg_${index}`,
        sessionId: "session_1",
        seq: index,
        payload: message,
        createdAt: now,
      })),
    );

    let ran = 0;
    const service = new SkillPostTurnReviewService(db, () => null, async () => {
      ran += 1;
    });

    expect(await service.runPostTurnSkillReview("session_1")).toBe("ran");
    expect(ran).toBe(1);
  });

  test("skips when flag disabled", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      id: "org_1",
      name: "Org",
      slug: "org",
      skillsPostTurnReview: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertProfile({
      id: "profile_1",
      name: "Bot",
      systemPrompt: "",
      model: null,
      isSuper: false,
      orgId: "org_1",
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertSession({
      id: "session_1",
      profileId: "profile_1",
      channel: "web",
      orgId: "org_1",
      userId: "user_1",
      createdAt: now,
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });

    let ran = 0;
    const service = new SkillPostTurnReviewService(db, () => null, async () => {
      ran += 1;
    });
    expect(await service.runPostTurnSkillReview("session_1")).toBe("flag_disabled");
    expect(ran).toBe(0);
  });

  test("skips duplicate while in flight", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      id: "org_1",
      name: "Org",
      slug: "org",
      skillsPostTurnReview: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertProfile({
      id: "profile_1",
      name: "Bot",
      systemPrompt: "",
      model: null,
      isSuper: false,
      orgId: "org_1",
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertSkill({
      id: "skill_manage_skills",
      name: "manage-skills",
      description: "Manage skills",
      sourcePath: "/tmp/manage-skills/SKILL.md",
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdBy: "bundled",
      createdAt: now,
      updatedAt: now,
    });
    await db.assignSkillToProfile("profile_1", "skill_manage_skills");
    await db.upsertSession({
      id: "session_1",
      profileId: "profile_1",
      channel: "cli",
      orgId: "org_1",
      userId: "user_1",
      createdAt: now,
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });
    await db.appendMessagesForSession("session_1", [
      {
        id: "msg_0",
        sessionId: "session_1",
        seq: 0,
        payload: { role: "user", content: "go" },
        createdAt: now,
      },
      {
        id: "msg_1",
        sessionId: "session_1",
        seq: 1,
        payload: assistantWithTools(5),
        createdAt: now,
      },
    ]);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ran = 0;
    const service = new SkillPostTurnReviewService(db, () => null, async () => {
      ran += 1;
      await gate;
    });

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
      id: "profile_1",
      name: "Bot",
      systemPrompt: "",
      model: "openai-1::gpt-5.4",
      isSuper: false,
      orgId: "org_1",
      createdAt: now,
      updatedAt: now,
    });

    const userConfig: UserConfig = {
      defaultProviderId: "openai-1",
      providers: [
        {
          id: "openai-1",
          type: "openai",
          label: "OpenAI",
          apiKey: "sk-test",
          createdAt: now,
        },
      ],
    };

    const service = new SkillPostTurnReviewService(db, () => userConfig);
    const provider = await service.resolveProviderForProfile("profile_1");
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("openai");
  });
});
