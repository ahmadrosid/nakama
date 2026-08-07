import { afterEach, beforeEach, expect, test } from "bun:test";
import { setCrashLogger, type CrashReport } from "@nakama/core/crash-report";
import type { ProviderClient, ToolDefinition } from "@nakama/core";
import { createAgentHarness } from "./index";

const sampleTool: ToolDefinition = {
  name: "sample",
  description: "Sample tool for tests",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  run() {
    return Promise.resolve({ ok: true });
  },
};

function toolCallResponse() {
  const toolCalls = [{ id: `call_${Math.random()}`, name: "sample", arguments: {} }];
  return {
    content: "",
    toolCalls,
    assistantMessage: { role: "assistant" as const, content: "", toolCalls },
  };
}

function textResponse(content: string) {
  return {
    content,
    toolCalls: [],
    assistantMessage: { role: "assistant" as const, content },
  };
}

/** Keeps asking for tools until `stopAfter` calls, then answers with `finalContent`. */
function createLoopingProvider(stopAfter: number, finalContent: string): ProviderClient {
  let calls = 0;

  const next = () => {
    calls += 1;
    return calls > stopAfter ? textResponse(finalContent) : toolCallResponse();
  };

  return {
    name: "openai",
    generateText: () => Promise.resolve({ content: "{}" }),
    generateChat: () => Promise.resolve(next()),
    streamChat: (_input, handlers) => {
      const result = next();

      if (result.content) {
        handlers.onChunk(result.content);
      }

      return Promise.resolve(result);
    },
  } as ProviderClient;
}

let reports: CrashReport[] = [];

beforeEach(() => {
  reports = [];
  setCrashLogger((report) => {
    reports.push(report);
  });
});

afterEach(() => {
  setCrashLogger(null);
});

function invariants() {
  return reports.filter((report) => report.kind === "invariant");
}

test("a turn that finishes normally reports nothing", async () => {
  const harness = createAgentHarness({
    provider: createLoopingProvider(1, "Done"),
    tools: [sampleTool],
  });

  const reply = await harness.createChatSession({ tools: [sampleTool] }).send("go");

  expect(reply).toBe("Done");
  expect(invariants()).toHaveLength(0);
});

test("running out of tool iterations is reported instead of returning quietly", async () => {
  const harness = createAgentHarness({
    // Never answers, so the loop runs to its cap.
    provider: createLoopingProvider(Number.POSITIVE_INFINITY, "never reached"),
    tools: [sampleTool],
  });

  await harness.createChatSession({ tools: [sampleTool] }).send("go");

  expect(invariants()).toHaveLength(1);
  expect(invariants()[0]?.message).toContain("iteration cap");
  expect(invariants()[0]?.source).toBe("agent");
});

test("an empty reply after tools ran is reported", async () => {
  const harness = createAgentHarness({
    provider: createLoopingProvider(1, "   "),
    tools: [sampleTool],
  });

  await harness.createChatSession({ tools: [sampleTool] }).send("go");

  expect(invariants()).toHaveLength(1);
  expect(invariants()[0]?.message).toContain("no reply");
});

test("an empty first reply is not reported, since no work was lost", async () => {
  const harness = createAgentHarness({
    provider: createLoopingProvider(0, ""),
    tools: [sampleTool],
  });

  await harness.createChatSession({ tools: [sampleTool] }).send("go");

  expect(invariants()).toHaveLength(0);
});
