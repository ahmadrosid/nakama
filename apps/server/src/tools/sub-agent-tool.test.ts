import { describe, expect, test } from "bun:test";
import { canRunToolCallsInParallel } from "@nakama/agent";
import type { ChatCompletionResult, GenerateChatInput } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../services/agent-service";
import { createDefaultProfile } from "../services/agent-service-test-fixtures";
import { sessionTurnRegistry } from "../services/session-turn-registry";
import { setupTestConfigDir } from "../test-config-dir";
import { formatToolActivityLabel } from "./sub-agent-activity";
import type { SubAgentRunResult } from "./sub-agent-shared";
import { createSubAgentTool, runSubAgentTool } from "./sub-agent-tool";

const ORG_ID = "org_test";

const PROFILE_ID = "profile_default";

const TOOL_CONTEXT = { agentDepth: 0, orgId: ORG_ID, profileId: PROFILE_ID };

function createMockAgentService(
  handler: (
    input: Parameters<AgentService["runSubAgentPrompt"]>[0]
  ) => Promise<SubAgentRunResult>
) {
  // SAFETY: Tests implement only runSubAgentPrompt, the sole method used by this tool.
  return {
    runSubAgentPrompt: handler,
  } as never;
}

describe("sub_agent tool", () => {
  test("returns success-shaped result from runner", async () => {
    const agent = createMockAgentService(async () => ({
      output: "Done",
      status: "success",
      summary: "Done",
    }));

    const tool = createSubAgentTool(agent);

    const result = await tool.run(
      { task: "Research competitors" },
      TOOL_CONTEXT
    );

    expect(result).toMatchObject({ status: "success", summary: "Done" });
  });

  test("rejects nested sub-agent calls", async () => {
    const agent = createMockAgentService(async () => ({
      output: "nope",
      status: "success",
      summary: "nope",
    }));

    const tool = createSubAgentTool(agent);

    const result = await tool.run(
      { task: "nested" },
      { ...TOOL_CONTEXT, agentDepth: 1 }
    );

    expect(result).toMatchObject({
      error: expect.stringContaining("Nested sub-agent"),
      status: "fail",
    });
  });

  test("rejects whitespace-only task", async () => {
    const agent = createMockAgentService(async () => ({
      output: "nope",
      status: "success",
      summary: "nope",
    }));

    const result = await runSubAgentTool({ task: "   " }, TOOL_CONTEXT, agent);

    expect(result.status).toBe("fail");
    expect(result.error).toContain("task is required");
  });

  test("clamps timeoutMs before calling runner", async () => {
    let capturedTimeout: number | undefined;

    const agent = createMockAgentService(async (input) => {
      capturedTimeout = input.timeoutMs;

      return { output: "ok", status: "success", summary: "ok" };
    });

    const tool = createSubAgentTool(agent);

    await tool.run({ task: "timed", timeoutMs: 999_999 }, TOOL_CONTEXT);

    expect(capturedTimeout).toBe(600_000);
  });

  test("inherits the trusted parent role, not a role supplied in tool arguments", async () => {
    for (const orgRole of ["admin", "member", undefined] as const) {
      let captured: unknown;

      const agent = createMockAgentService(async (input) => {
        captured = input;

        return { output: "ok", status: "success", summary: "ok" };
      });

      const input = { orgRole: "admin", task: "delegated" };
      await runSubAgentTool(input, { ...TOOL_CONTEXT, orgRole }, agent);

      expect(captured).toMatchObject({ orgRole });
    }
  });

  test("is parallelSafe so sibling sub-agents can run concurrently from the parent", () => {
    const tool = createSubAgentTool(
      createMockAgentService(async () => ({
        output: "ok",
        status: "success",
        summary: "ok",
      }))
    );

    expect(tool.parallelSafe).toBe(true);
    expect(
      canRunToolCallsInParallel(
        [tool],
        [
          { arguments: { task: "first" }, id: "a", name: "sub_agent" },
          { arguments: { task: "second" }, id: "b", name: "sub_agent" },
        ]
      )
    ).toBe(true);
  });
});

test("tool activity accepts missing details for every tool branch", () => {
  for (const tool of [
    "read_file",
    "search_files",
    "knowledge_base_search",
    "web_fetch",
    "web_search",
    "bash",
    "write_file",
    "write_docx",
    "edit_file",
    "delete_file",
    "custom_tool",
  ]) {
    expect(formatToolActivityLabel(tool)).toEqual(expect.any(String));
  }

  expect(
    formatToolActivityLabel("write_file", { path: "/tmp/report.md" })
  ).toBe("Writing report.md");
});

describe("sub_agent background", () => {
  test("starts a child chat, one level deep and at most five per chat", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const agent = new AgentService(null, null, db);

    const parentId = await agent.createSession(ORG_ID, "web", PROFILE_ID);
    const parentContext = { ...TOOL_CONTEXT, sessionId: parentId };

    const started = await runSubAgentTool(
      { background: true, task: "Draft the marketing plan" },
      parentContext,
      agent
    );

    expect(started.status).toBe("success");
    expect(await db.getSession(started.sessionId ?? "")).toMatchObject({
      parentSessionId: parentId,
      title: "Draft the marketing plan",
    });

    const fromChild = await runSubAgentTool(
      { background: true, task: "Go deeper" },
      { ...TOOL_CONTEXT, sessionId: started.sessionId },
      agent
    );

    expect(fromChild.status).toBe("fail");

    for (let index = 0; index < 4; index += 1) {
      expect(
        (
          await runSubAgentTool(
            { background: true, task: `Topic ${index}` },
            parentContext,
            agent
          )
        ).status
      ).toBe("success");
    }

    expect(
      (
        await runSubAgentTool(
          { background: true, task: "One too many" },
          parentContext,
          agent
        )
      ).status
    ).toBe("fail");

    const branch = await agent.createSession(ORG_ID, "web", PROFILE_ID);
    const branchRecord = await db.getSession(branch);

    if (branchRecord) {
      await db.upsertSession({
        ...branchRecord,
        branchMessageIndex: 0,
        parentSessionId: parentId,
      });
    }

    // A branch also has a parent, and must keep sub_agent.
    expect(
      (
        await runSubAgentTool(
          { background: true, task: "From a branch" },
          { ...TOOL_CONTEXT, sessionId: branch },
          agent
        )
      ).status
    ).toBe("success");

    const stranger = await agent.createSession(ORG_ID, "web", PROFILE_ID);

    expect(
      (
        await runSubAgentTool(
          { background: true, sessionId: stranger, task: "Continue" },
          parentContext,
          agent
        )
      ).status
    ).toBe("fail");
  });

  test("a foreground run also gets its own chat under the parent", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const agent = new AgentService(null, null, db);
    const parentId = await agent.createSession(ORG_ID, "web", PROFILE_ID);

    // No provider here, so the turn fails; the chat it ran in is what counts.
    const result = await runSubAgentTool(
      { task: "Summarize the plan", timeoutMs: 60_000 },
      { ...TOOL_CONTEXT, sessionId: parentId },
      agent
    );

    expect((await db.getSession(result.sessionId ?? ""))?.parentSessionId).toBe(
      parentId
    );
  });
});

describe("sub_agent child chats", () => {
  setupTestConfigDir("nakama-sub-agent-child-");

  interface Captured {
    names: string[];
    system: string;
  }

  /** Each turn goes through `respond`; the last call's tools and prompt land in `captured`. */
  async function createService(
    respond: (input: GenerateChatInput) => Promise<ChatCompletionResult>
  ) {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());

    // Platform tool groups only attach when the profile owns at least one tool.
    const now = new Date().toISOString();
    await db.upsertTool({
      createdAt: now,
      description: "Test tool",
      handlerConfig: { modulePath: "test.js" },
      handlerType: "javascript",
      id: "tool_sub_agent_seed",
      name: "test_tool",
      updatedAt: now,
    });
    await db.assignToolToProfile(PROFILE_ID, "tool_sub_agent_seed");

    const service = new AgentService(null, null, db);
    const captured: Captured = { names: [], system: "" };

    const record = (input: GenerateChatInput) => {
      captured.names = (input.tools ?? []).map((tool) => tool.name);
      captured.system = input.system;

      return respond(input);
    };

    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: { generateChat: record, name: "openai", streamChat: record },
      }),
    });

    return { captured, db, service };
  }

  const answer = (reply: string): Promise<ChatCompletionResult> =>
    Promise.resolve({
      assistantMessage: { content: reply, role: "assistant", toolCalls: [] },
      content: reply,
      toolCalls: [],
    });

  test("a child chat has no question, todo or sub_agent tools", async () => {
    const { captured, service } = await createService(() => answer("Done"));
    const parentId = await service.createSession(ORG_ID, "web", PROFILE_ID);

    const parent = await service.sessions.get(parentId, ORG_ID);
    await parent?.send({ message: "hi" });
    expect(captured.names).toContain("ask_user_question");
    expect(captured.names).toContain("todo_write");

    const result = await runSubAgentTool(
      { task: "Summarize the plan" },
      { ...TOOL_CONTEXT, sessionId: parentId },
      service
    );

    expect(result).toMatchObject({ output: "Done", status: "success" });
    expect(captured.names).not.toContain("ask_user_question");
    expect(captured.names).not.toContain("todo_write");
    expect(captured.names).not.toContain("sub_agent");
    expect(captured.system).toContain("Do not spawn sub-agents.");
  });

  test("a cognito chat runs sub_agent in memory and leaves no chat", async () => {
    const { db, service } = await createService(() => answer("Done"));

    const parentId = await service.createSession(
      ORG_ID,
      "web",
      PROFILE_ID,
      null,
      { cognito: true }
    );

    const context = { ...TOOL_CONTEXT, sessionId: parentId };

    expect(
      await runSubAgentTool({ task: "Research it" }, context, service)
    ).toMatchObject({ output: "Done", status: "success" });

    expect(
      (
        await runSubAgentTool(
          { background: true, task: "Research it" },
          context,
          service
        )
      ).status
    ).toBe("fail");

    expect(await db.listSessions()).toHaveLength(0);
  });

  test("stopping the parent stops the child it waits for", async () => {
    const { service } = await createService(
      (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        })
    );

    const parentId = await service.createSession(ORG_ID, "web", PROFILE_ID);
    const stop = new AbortController();

    const pending = runSubAgentTool(
      { task: "Take forever", timeoutMs: 60_000 },
      { ...TOOL_CONTEXT, sessionId: parentId, signal: stop.signal },
      service
    );

    setTimeout(() => stop.abort(), 20);
    const result = await pending;

    expect(result.status).toBe("fail");
    // The child turn ended, so the child chat takes a new message.
    expect(await service.beginSessionTurn(result.sessionId ?? "", ORG_ID)).toBe(
      true
    );
    // The registry is shared by every test file; leave no turn running.
    sessionTurnRegistry.cancelTurn(result.sessionId ?? "");
  });

  test("a child that runs past timeoutMs reports timeout", async () => {
    const { service } = await createService(
      (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        })
    );

    const parentId = await service.createSession(ORG_ID, "web", PROFILE_ID);

    const result = await runSubAgentTool(
      { task: "Take forever", timeoutMs: 50 },
      { ...TOOL_CONTEXT, sessionId: parentId },
      service
    );

    expect(result.status).toBe("timeout");
  });
});
