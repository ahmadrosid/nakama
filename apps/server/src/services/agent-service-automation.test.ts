import { describe, expect, test } from "bun:test";
import type { GenerateChatInput, ToolDefinition } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

const ORG_ID = "org_test";

describe("AgentService organization knowledge base", () => {
  setupTestConfigDir("nakama-org-knowledge-base-");

  test("serves organization documents through the profile service", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(null, null, db);

    const uploaded = await service.uploadOrganizationKnowledgeBaseDocument(
      ORG_ID,
      {
        data: Buffer.from("shared organization fact", "utf8").toString(
          "base64"
        ),
        filename: "shared.txt",
        mediaType: "text/plain",
      }
    );

    expect(uploaded.outcome).toBe("created");
    expect(uploaded.document.scope).toBe("organization");

    const listed = await service.listOrganizationKnowledgeBase(ORG_ID);
    expect(listed.documents.map((document) => document.id)).toEqual([
      uploaded.document.id,
    ]);

    const read = await service.readOrganizationKnowledgeBaseDocument(
      ORG_ID,
      uploaded.document.id
    );

    expect(read.filename).toBe("shared.txt");

    const deleted = await service.deleteOrganizationKnowledgeBaseDocument(
      ORG_ID,
      uploaded.document.id
    );

    expect(deleted.deleted).toBe(true);
    expect(deleted.documentId).toBe(uploaded.document.id);
  });
});

async function captureError<T>(run: () => Promise<T>): Promise<Error | null> {
  try {
    await run();

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe("AgentService automation resume", () => {
  setupTestConfigDir("nakama-automation-resume-");

  async function setup() {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertProfile(createDefaultProfile());
    await db.upsertAutomation({
      createdAt: now,
      definition: { trigger: { type: "manual" } },
      enabled: true,
      id: "auto_resume",
      name: "Resume",
      profileId: "profile_default",
      updatedAt: now,
      version: 1,
    });
    await db.insertAutomationRun({
      automationId: "auto_resume",
      completedAt: null,
      error: null,
      id: "run_resume",
      output: null,
      startedAt: now,
      status: "running",
    });
    const calls: string[] = [];
    const received: GenerateChatInput["messages"][] = [];

    const tool = (name: string, parallelSafe: boolean): ToolDefinition => ({
      description: name,
      name,
      parallelSafe,
      parameters: { properties: {}, type: "object" },
      run() {
        calls.push(name);

        return Promise.resolve({ ran: name });
      },
    });

    const tools = [
      tool("read_file", true),
      tool("writes", false),
      tool("sub_agent", true),
      tool("custom_write", true),
    ];

    const service = new AgentService(null, null, db);
    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat(input: GenerateChatInput) {
            received.push(input.messages);

            return Promise.resolve({
              assistantMessage: { content: "Finished", role: "assistant" },
              content: "Finished",
              toolCalls: [],
            });
          },
        },
      }),
      resolveProfileSystemPrompt: () =>
        Promise.resolve({ soulActive: false, systemPrompt: "Test" }),
      resolveProfileTools: () => Promise.resolve(tools),
    });

    const step = (
      position: number,
      toolCallId: string,
      toolName: string,
      done: boolean
    ) => ({
      args: "{}",
      completedAt: done ? now : null,
      position,
      result: done ? '{"ran":"earlier"}' : null,
      runId: "run_resume",
      startedAt: now,
      status: done ? ("completed" as const) : ("running" as const),
      toolCallId,
      toolGroupId: "group_1",
      toolName,
    });

    return { calls, db, received, service, step };
  }

  test("continues from saved steps and repeats only read-only tools", async () => {
    const { calls, db, received, service, step } = await setup();
    await db.insertAutomationRunStep(step(0, "call_done", "writes", true));
    await db.insertAutomationRunStep(step(1, "call_read", "read_file", false));
    await db.insertAutomationRunStep(step(2, "call_write", "writes", false));
    await db.insertAutomationRunStep(step(3, "call_sub", "sub_agent", false));
    await db.insertAutomationRunStep(
      step(4, "call_custom", "custom_write", false)
    );

    const output = await service.runAutomationPrompt(
      ORG_ID,
      "profile_default",
      "Do the job",
      "auto_resume",
      "run_resume",
      undefined,
      true
    );

    expect(output).toBe("Finished");
    // The cut read-only call runs again; neither write runs a second time.
    expect(calls).toEqual(["read_file"]);
    const toolMessages = received[0]?.filter((m) => m.role === "tool") ?? [];
    expect(toolMessages.map((m) => m.toolCallId)).toEqual([
      "call_done",
      "call_read",
      "call_write",
      "call_sub",
      "call_custom",
    ]);
    expect(toolMessages[1]?.content).toContain("read_file");
    expect(toolMessages[2]?.content).toContain("error");
    expect(toolMessages[3]?.content).toContain("error");
    expect(toolMessages[4]?.content).toContain("error");

    const steps = await db.listAutomationRunSteps("run_resume");
    expect(steps.every((item) => item.status === "completed")).toBe(true);
  });

  test("saves each tool call of a fresh run", async () => {
    const { db, service } = await setup();
    Object.assign(service, {
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat(input: GenerateChatInput) {
            const done = input.messages.at(-1)?.role === "tool";

            const toolCalls = done
              ? []
              : [{ arguments: { q: 1 }, id: "call_new", name: "read_file" }];

            return Promise.resolve({
              assistantMessage: {
                content: done ? "Done" : "",
                role: "assistant",
                toolCalls,
              },
              content: done ? "Done" : "",
              toolCalls,
            });
          },
        },
      }),
    });

    await service.runAutomationPrompt(
      ORG_ID,
      "profile_default",
      "Do the job",
      "auto_resume",
      "run_resume",
      { onChunk() {} }
    );

    const steps = await db.listAutomationRunSteps("run_resume");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("completed");
    expect(steps[0]?.args).toBe('{"q":1}');
  });
});
