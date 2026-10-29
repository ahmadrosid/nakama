import { describe, expect, test } from "bun:test";
import type { AgentDependencies } from "@nakama/agent";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type StoredProfileRecord,
} from "@nakama/db";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

const ORG_ID = "org_test";

type CreateHarnessForProfile = (
  profile: StoredProfileRecord,
  selectedModel: string | null,
  userId?: string | null,
  acpSessionKey?: string,
  acpTools?: { context: ToolContext; tools: ToolDefinition[] },
  thinking?: { effort?: string }
) => AgentDependencies;

interface AgentServiceHarnessAccess {
  createHarnessForProfile: CreateHarnessForProfile;
  sessions: Map<string, unknown>;
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("AgentService run settings", () => {
  test("keeps run settings through create, branch and restore", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      model: "provider-1::base",
    });

    const service = new AgentService(
      {
        defaultProviderId: "provider-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "base" },
              { id: "a" },
              { id: "b" },
            ],
            id: "provider-1",
            label: "Test provider",
            type: "openai_compatible",
          },
        ],
      },
      null,
      db
    );

    const access = privateServiceAccess<AgentServiceHarnessAccess>(service);
    const { createHarnessForProfile } = access;
    const built: { effort: string | undefined; model: string | null }[] = [];

    Object.defineProperty(service, "createHarnessForProfile", {
      value: (...args: Parameters<CreateHarnessForProfile>) => {
        built.push({ effort: args[5]?.effort, model: args[1] });

        return createHarnessForProfile.apply(service, args);
      },
    });

    const expectSettings = async (
      sessionId: string,
      model: string,
      effort: "low" | "medium" | "high"
    ) => {
      const record = await db.getSession(sessionId);
      expect(record?.model).toBe(model);
      expect(record?.thinkingEffort).toBe(effort);
      expect(built.at(-1)).toEqual({ effort, model });
    };

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { model: "provider-1::a", thinkingEffort: "low" }
    );

    await expectSettings(sessionId, "provider-1::a", "low");

    await db.replaceMessagesForSession(sessionId, [
      {
        createdAt: "2026-10-30T00:00:00.000Z",
        id: "msg_run_settings",
        payload: { content: "Keep the settings", role: "user" },
        seq: 0,
        sessionId,
      },
    ]);

    const branchId = (await service.branchSession(sessionId, 0, ORG_ID))!
      .sessionId;

    await expectSettings(branchId, "provider-1::a", "low");

    expect(
      await service.updateSessionRunSettings(sessionId, ORG_ID, {
        model: "provider-1::b",
        thinkingEffort: "high",
      })
    ).toBe(true);

    access.sessions.clear();
    await service.resolveSession(sessionId, ORG_ID);
    await expectSettings(sessionId, "provider-1::b", "high");

    access.sessions.clear();
    await service.resolveSession(branchId, ORG_ID);
    await expectSettings(branchId, "provider-1::a", "low");

    // The model write lands, then the effort write fails: the cached chat
    // must not keep running on the old model.
    await service.resolveSession(sessionId, ORG_ID);
    db.updateSessionThinkingEffort = () => Promise.reject(new Error("db down"));

    await expect(
      service.updateSessionRunSettings(sessionId, ORG_ID, {
        model: "provider-1::a",
        thinkingEffort: "low",
      })
    ).rejects.toThrow();

    const buildsBefore = built.length;
    await service.resolveSession(sessionId, ORG_ID);
    expect(built.length).toBe(buildsBefore + 1);
    await expectSettings(sessionId, "provider-1::a", "high");
  });
});
