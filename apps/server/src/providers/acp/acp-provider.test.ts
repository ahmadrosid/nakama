import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { GenerateChatInput, StreamChatHandlers } from "@nakama/core";
import { createAcpProvider, stopAcpSession } from "./acp-provider";

const FAKE_AGENT = fileURLToPath(
  new URL("../../testing/acp-fake-agent.ts", import.meta.url)
);

const cwd = process.cwd();

let sessionCounter = 0;

function nextSessionKey(): string {
  sessionCounter += 1;

  return `test-session-${sessionCounter}`;
}

function createProvider(sessionKey: string) {
  return createAcpProvider({
    agent: { args: [FAKE_AGENT], command: "bun" },
    cwd,
    sessionKey,
  });
}

function collectHandlers() {
  const chunks: string[] = [];
  const thoughts: string[] = [];

  const toolStarts: Array<{
    input: unknown;
    tool: string;
    toolCallId: string;
  }> = [];

  const toolEnds: Array<{
    result: unknown;
    tool: string;
    toolCallId: string;
  }> = [];

  const handlers: StreamChatHandlers = {
    onChunk: (delta) => {
      chunks.push(delta);
    },
    onThinking: (delta) => {
      thoughts.push(delta);
    },
    onToolEnd: (event) => {
      toolEnds.push(event);
    },
    onToolStart: (event) => {
      toolStarts.push(event);
    },
  };

  return { chunks, handlers, thoughts, toolEnds, toolStarts };
}

function chatInput(text: string, system = ""): GenerateChatInput {
  return {
    messages: [{ content: text, role: "user" }],
    system,
  };
}

afterEach(() => {
  for (let index = 1; index <= sessionCounter; index += 1) {
    stopAcpSession(`test-session-${index}`);
  }
});

describe("ACP provider", () => {
  test("returns the agent reply and streams its text chunks", async () => {
    const provider = createProvider(nextSessionKey());
    const { chunks, handlers } = collectHandlers();

    const result = await provider.streamChat(chatInput("hello"), handlers);

    expect(result.content).toBe("fake: hello");
    expect(chunks.join("")).toBe("fake: hello");
    expect(result.toolCalls).toEqual([]);
  });

  test("streams tool calls with their input and result", async () => {
    const provider = createProvider(nextSessionKey());
    const { handlers, toolEnds, toolStarts } = collectHandlers();

    await provider.streamChat(chatInput("run a tool"), handlers);

    expect(toolStarts).toEqual([
      { input: { query: "notes" }, tool: "search_files", toolCallId: "call-1" },
    ]);
    expect(toolEnds).toEqual([
      {
        result: { matches: 2 },
        tool: "search_files",
        toolCallId: "call-1",
      },
    ]);
  });

  test("streams thinking separately from the reply", async () => {
    const provider = createProvider(nextSessionKey());
    const { chunks, handlers, thoughts } = collectHandlers();

    const result = await provider.streamChat(
      chatInput("thought first"),
      handlers
    );

    expect(thoughts).toEqual(["thinking about it"]);
    expect(chunks.join("")).toBe("fake: thought first");
    expect(result.content).toBe("fake: thought first");
  });

  test("passes the Nakama MCP servers to the agent session", async () => {
    const sessionKey = nextSessionKey();

    const provider = createAcpProvider({
      agent: { args: [FAKE_AGENT], command: "bun" },
      cwd,
      mcpServers: [
        { args: [], command: "nakama-bridge", env: [], name: "nakama" },
      ],
      sessionKey,
    });

    const result = await provider.generateChat(chatInput("mcp check"));

    expect(result.content).toBe("mcp servers: 1");
  });

  test("sends the system prompt on the first turn only", async () => {
    const provider = createProvider(nextSessionKey());

    const first = await provider.generateChat(chatInput("first", "Be brief."));

    const second = await provider.generateChat(
      chatInput("second", "Be brief.")
    );

    expect(first.content).toBe("fake: Be brief.\n\nfirst");
    expect(second.content).toBe("fake: second");
  });

  test("rejects a turn with no user message", async () => {
    const provider = createProvider(nextSessionKey());

    await expect(
      provider.generateChat({ messages: [], system: "" })
    ).rejects.toThrow("ACP agent turns need a user message.");
  });

  test("does not generate text on its own", async () => {
    const provider = createProvider(nextSessionKey());

    await expect(
      provider.generateText({ prompt: "title", system: "" })
    ).rejects.toThrow("ACP agents do not generate text");
  });
});
