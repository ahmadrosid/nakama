import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import type { StreamChatHandlers } from "@nakama/core";
import { createAcpUpdateMapper } from "./acp-session-events";

function recorder() {
  const starts: Array<{ input: unknown; tool: string; toolCallId: string }> =
    [];

  const ends: Array<{ result: unknown; tool: string; toolCallId: string }> = [];

  const handlers: StreamChatHandlers = {
    onChunk: () => {},
    onToolEnd: (event) => {
      ends.push(event);
    },
    onToolStart: (event) => {
      starts.push(event);
    },
  };

  return { ends, handlers, starts };
}

function notify(update: acp.SessionUpdate): acp.SessionNotification {
  return { sessionId: "s", update };
}

describe("ACP tool steps", () => {
  test("a Nakama MCP tool shows under its Nakama name, with its input and result", () => {
    const { ends, handlers, starts } = recorder();
    const mapper = createAcpUpdateMapper(handlers);

    mapper.handle(
      notify({
        _meta: {
          claudeCode: { toolName: "mcp__nakama__knowledge_base_search" },
        },
        kind: "other",
        rawInput: {},
        sessionUpdate: "tool_call",
        status: "pending",
        title: "mcp__nakama__knowledge_base_search",
        toolCallId: "t1",
      })
    );
    expect(starts).toHaveLength(0);

    mapper.handle(
      notify({
        _meta: {
          claudeCode: { toolName: "mcp__nakama__knowledge_base_search" },
        },
        rawInput: { query: "ACP" },
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
      })
    );
    mapper.handle(
      notify({
        _meta: {
          claudeCode: { toolName: "mcp__nakama__knowledge_base_search" },
        },
        rawOutput: [{ text: '{"matchCount":0}', type: "text" }],
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "t1",
      })
    );

    expect(starts).toEqual([
      {
        input: { query: "ACP" },
        tool: "knowledge_base_search",
        toolCallId: "t1",
      },
    ]);
    expect(ends).toEqual([
      {
        result: [{ text: '{"matchCount":0}', type: "text" }],
        tool: "knowledge_base_search",
        toolCallId: "t1",
      },
    ]);
  });

  test("a Claude Bash call shows as bash with its command, not as Terminal", () => {
    const { starts, handlers } = recorder();
    const mapper = createAcpUpdateMapper(handlers);

    mapper.handle(
      notify({
        _meta: { claudeCode: { toolName: "Bash" } },
        kind: "execute",
        rawInput: {},
        sessionUpdate: "tool_call",
        status: "pending",
        title: "Terminal",
        toolCallId: "b1",
      })
    );
    mapper.handle(
      notify({
        _meta: { claudeCode: { toolName: "Bash" } },
        rawInput: { command: "echo hello" },
        sessionUpdate: "tool_call_update",
        title: "echo hello",
        toolCallId: "b1",
      })
    );

    expect(starts).toEqual([
      { input: { command: "echo hello" }, tool: "bash", toolCallId: "b1" },
    ]);
  });

  test("a Nakama read keeps the path under the key Nakama reads", () => {
    const { starts, handlers } = recorder();
    const mapper = createAcpUpdateMapper(handlers);

    mapper.handle(
      notify({
        _meta: { claudeCode: { toolName: "mcp__nakama__read_file" } },
        rawInput: { path: "acp-edit-check.md" },
        sessionUpdate: "tool_call_update",
        toolCallId: "r1",
      })
    );

    expect(starts).toEqual([
      {
        input: { path: "acp-edit-check.md" },
        tool: "read_file",
        toolCallId: "r1",
      },
    ]);
  });

  test("a step that completes without input still shows once", () => {
    const { ends, starts, handlers } = recorder();
    const mapper = createAcpUpdateMapper(handlers);

    mapper.handle(
      notify({
        _meta: { claudeCode: { toolName: "mcp__nakama__web_fetch" } },
        rawOutput: "ok",
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "w1",
      })
    );

    expect(starts).toEqual([
      { input: {}, tool: "web_fetch", toolCallId: "w1" },
    ]);
    expect(ends).toEqual([
      { result: "ok", tool: "web_fetch", toolCallId: "w1" },
    ]);
  });
});
