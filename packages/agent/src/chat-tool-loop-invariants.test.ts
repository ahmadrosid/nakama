import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ProviderClient, ToolDefinition } from "@nakama/core";
import { type CrashReport, setCrashLogger } from "@nakama/core/crash-report";
import { createAgentHarness } from "./index";

const sampleTool: ToolDefinition = {
  description: "Sample tool for tests",
  name: "sample",
  parameters: { additionalProperties: false, properties: {}, type: "object" },
  run() {
    return Promise.resolve({ ok: true });
  },
};

function toolCallResponse() {
  const toolCalls = [
    { arguments: {}, id: `call_${Math.random()}`, name: "sample" },
  ];
  return {
    assistantMessage: { content: "", role: "assistant" as const, toolCalls },
    content: "",
    toolCalls,
  };
}

function textResponse(content: string) {
  return {
    assistantMessage: { content, role: "assistant" as const },
    content,
    toolCalls: [],
  };
}

/** Keeps asking for tools until `stopAfter` calls, then answers with `finalContent`. */
function createLoopingProvider(
  stopAfter: number,
  finalContent: string
): ProviderClient {
  let calls = 0;

  const next = () => {
    calls += 1;
    return calls > stopAfter ? textResponse(finalContent) : toolCallResponse();
  };

  return {
    generateChat: () => Promise.resolve(next()),
    generateText: () => Promise.resolve({ content: "{}" }),
    name: "openai",
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

  const reply = await harness
    .createChatSession({ tools: [sampleTool] })
    .send("go");

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
