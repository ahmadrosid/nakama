import { expect, test } from "bun:test";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import { createAgentChatSession } from "./chat";
import { createCodeModeTool } from "./code-mode";
import { createCapturingProvider } from "./test-helpers";

function setup(tools: ToolDefinition[]) {
  const records: Array<{ id: string; status: string }> = [];

  const context: ToolContext = {
    codeModeAudit: {
      async begin({ id }) {
        records.push({ id, status: "running" });
      },
      async complete({ id, status }) {
        records.push({ id, status });
      },
    },
    orgId: "org_1",
    parentToolCallId: "parent_1",
    sessionId: "session_1",
  };

  const execute = createCodeModeTool(tools, context);

  if (!execute) {
    throw new Error("No code-mode catalog");
  }

  return { context, execute, records };
}

const inputSchema = {
  additionalProperties: false,
  properties: { query: { type: "string" } },
  required: ["query"],
  type: "object",
};

test("code mode combines assigned built-in and MCP results without a child result in chat", async () => {
  const { execute, context, records } = setup([
    {
      description: "Find files",
      name: "search_files",
      parallelSafe: true,
      parameters: inputSchema,
      async run() {
        return { matches: ["one", "two"] };
      },
    },
    {
      codeModeEligible: true,
      description: "List issues",
      name: "issues__list",
      parameters: inputSchema,
      async run() {
        return { issues: ["one", "three"] };
      },
    },
  ]);

  expect(
    await execute.run(
      {
        code: 'const files = await tools.search_files({query:"one"}); const issues = await tools.issues__list({query:"one"}); return issues.issues.filter(x => files.matches.includes(x));',
      },
      context
    )
  ).toEqual(["one"]);
  expect(records.map((record) => record.status)).toEqual([
    "running",
    "completed",
    "running",
    "completed",
  ]);
});

test("code mode rejects unassigned tools and invalid input before dispatch", async () => {
  let calls = 0;

  const { execute, context, records } = setup([
    {
      description: "Find files",
      name: "search_files",
      parameters: inputSchema,
      async run() {
        calls++;

        return {};
      },
    },
  ]);

  expect(
    await execute.run(
      { code: 'return await tools.not_assigned({query:"a"});' },
      context
    )
  ).toHaveProperty("error");
  expect(
    await execute.run(
      { code: "return await tools.search_files({query:9});" },
      context
    )
  ).toHaveProperty("error");
  expect(calls).toBe(0);
  expect(records).toEqual([]);
});

test("code mode fails closed when audit begin fails", async () => {
  let calls = 0;

  const tool: ToolDefinition = {
    description: "Find files",
    name: "search_files",
    parameters: inputSchema,
    async run() {
      calls++;

      return {};
    },
  };

  const { execute, context } = setup([tool]);
  context.codeModeAudit!.begin = async () => {
    throw new Error("audit unavailable");
  };

  expect(
    await execute.run(
      { code: 'return await tools.search_files({query:"a"});' },
      context
    )
  ).toHaveProperty("error");
  expect(calls).toBe(0);
});

test("code mode waits for an unawaited child and records media without repeating the call", async () => {
  let calls = 0;

  const { execute, context, records } = setup([
    {
      codeModeEligible: true,
      description: "Get issue",
      name: "issues__get",
      parameters: inputSchema,
      async run() {
        calls++;

        return { hasMedia: true, value: null };
      },
    },
  ]);

  const result = await execute.run(
    { code: 'tools.issues__get({query:"a"}); return "done";' },
    context
  );

  expect(result).toHaveProperty("error");
  expect(calls).toBe(1);
  expect(records.map((record) => record.status)).toEqual(["running", "media"]);
});

test("code mode runs safe reads together and other tools in call order", async () => {
  let active = 0;
  let peak = 0;
  const order: string[] = [];

  const read: ToolDefinition = {
    description: "Find files",
    name: "search_files",
    parallelSafe: true,
    parameters: inputSchema,
    async run(input) {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(10);
      active--;
      // SAFETY: Ajv validates this tool's query schema before execution.
      order.push((input as { query: string }).query);

      return {};
    },
  };

  const write: ToolDefinition = {
    codeModeEligible: true,
    description: "Write issue",
    name: "issues__write",
    parameters: inputSchema,
    async run() {
      expect(active).toBe(0);
      order.push("write");

      return {};
    },
  };

  const { execute, context } = setup([read, write]);
  expect(
    await execute.run(
      {
        code: 'return await Promise.all([...Array.from({length:6}, (_, i) => tools.search_files({query:String(i)})),tools.issues__write({query:"c"})]);',
      },
      context
    )
  ).toEqual([{}, {}, {}, {}, {}, {}, {}]);
  expect(peak).toBe(4);
  expect(order.at(-1)).toBe("write");
});

test("code mode serializes MCP calls in Promise.all", async () => {
  let active = 0;
  let peak = 0;

  const { execute, context } = setup([
    {
      codeModeEligible: true,
      description: "Write issue",
      name: "issues__write",
      parameters: inputSchema,
      async run() {
        active++;
        peak = Math.max(peak, active);
        await Bun.sleep(10);
        active--;

        return {};
      },
    },
  ]);

  expect(
    await execute.run(
      {
        code: 'return await Promise.all([tools.issues__write({query:"a"}),tools.issues__write({query:"b"})]);',
      },
      context
    )
  ).toEqual([{}, {}]);
  expect(peak).toBe(1);
});

test("code mode has no process or network globals", async () => {
  const { execute, context } = setup([
    {
      description: "Find files",
      name: "search_files",
      parameters: inputSchema,
      async run() {
        return {};
      },
    },
  ]);

  expect(
    await execute.run(
      { code: "return [typeof process, typeof fetch, typeof require];" },
      context
    )
  ).toEqual(["undefined", "undefined", "undefined"]);
});

test("code mode is unavailable without durable audit or an eligible schema", () => {
  const tool: ToolDefinition = {
    description: "Find files",
    name: "search_files",
    parameters: inputSchema,
    async run() {
      return {};
    },
  };

  expect(
    createCodeModeTool([tool], { orgId: "org_1", sessionId: "session_1" })
  ).toBeNull();
  expect(
    createCodeModeTool([tool], {
      // SAFETY: This test passes an incomplete audit object to verify the guard.
      codeModeAudit: { begin: async () => {} } as never,
      orgId: "org_1",
      sessionId: "session_1",
    })
  ).toBeNull();
  expect(
    createCodeModeTool(
      [
        {
          ...tool,
          // SAFETY: This test injects an invalid schema to verify catalog rejection.
          parameters: { ...inputSchema, unsupportedKeyword: true } as never,
        },
      ],
      setup([tool]).context
    )
  ).toBeNull();
});

test("chat exposes execute only with audit and stores only the outer result", async () => {
  const read: ToolDefinition = {
    description: "Find files",
    name: "search_files",
    parameters: inputSchema,
    async run() {
      return { matches: ["one", "two"] };
    },
  };

  const context = setup([read]).context;
  let calls = 0;

  const provider = createCapturingProvider({
    assistantMessage: { content: "Done", role: "assistant" },
    content: "Done",
    toolCalls: [],
  });

  const original = provider.generateChat;
  provider.generateChat = async (input) => {
    calls++;

    if (calls === 1) {
      expect(input.tools?.map((tool) => tool.name)).toEqual([
        "search_files",
        "execute",
      ]);

      return {
        assistantMessage: {
          content: "",
          role: "assistant",
          toolCalls: [
            {
              arguments: {
                code: 'return (await tools.search_files({query:"one"})).matches.slice(0,1);',
              },
              id: "outer_1",
              name: "execute",
            },
          ],
        },
        content: "",
        toolCalls: [
          {
            arguments: {
              code: 'return (await tools.search_files({query:"one"})).matches.slice(0,1);',
            },
            id: "outer_1",
            name: "execute",
          },
        ],
      };
    }

    return original(input);
  };

  const session = createAgentChatSession(
    { provider, tools: [read] },
    { toolContext: context, tools: [read] }
  );

  await session.send("Find a file");
  expect(
    session.getHistory().filter((message) => message.role === "tool")
  ).toHaveLength(1);
  expect(
    session.getHistory().find((message) => message.role === "tool")?.content
  ).toBe('["one"]');

  const withoutAudit = createCapturingProvider({
    assistantMessage: { content: "Done", role: "assistant" },
    content: "Done",
    toolCalls: [],
  });

  await createAgentChatSession(
    { provider: withoutAudit, tools: [read] },
    { tools: [read] }
  ).send("Find a file");
  expect(withoutAudit.lastInput?.tools?.map((tool) => tool.name)).toEqual([
    "search_files",
  ]);
});

test("code mode interrupts a busy loop and caps output", async () => {
  const { execute, context } = setup([
    {
      description: "Find files",
      name: "search_files",
      parameters: inputSchema,
      async run() {
        return {};
      },
    },
  ]);

  const started = Date.now();
  expect(
    await execute.run({ code: "while (true) {}" }, context)
  ).toHaveProperty("error");
  expect(Date.now() - started).toBeLessThan(9000);
  expect(
    await execute.run({ code: 'return "x".repeat(20000);' }, context)
  ).toHaveProperty("error");
  expect(
    await execute.run(
      {
        code: 'return await Promise.all(Array.from({length:13}, () => tools.search_files({query:"x"})));',
      },
      context
    )
  ).toHaveProperty("error");
}, 12_000);

test("code mode cancels an active child and marks its outcome unknown", async () => {
  const controller = new AbortController();
  let sawSignal = false;
  let started!: () => void;

  const running = new Promise<void>((resolve) => {
    started = resolve;
  });

  const { execute, context, records } = setup([
    {
      codeModeEligible: true,
      description: "Slow MCP call",
      name: "issues__slow",
      parameters: inputSchema,
      async run(_input, childContext) {
        childContext.signal?.addEventListener("abort", () => {
          sawSignal = true;
        });
        started();
        await Bun.sleep(50);

        return {};
      },
    },
  ]);

  context.signal = controller.signal;

  const result = execute.run(
    { code: 'return await tools.issues__slow({query:"a"});' },
    context
  );

  await running;
  controller.abort();
  expect(await result).toHaveProperty("error");
  expect(sawSignal).toBe(true);
  expect(records.map((record) => record.status)).toEqual([
    "running",
    "unknown",
  ]);
});
