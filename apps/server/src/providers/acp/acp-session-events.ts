import type * as acp from "@agentclientprotocol/sdk";
import type { JsonValue, StreamChatHandlers, ToolCall } from "@nakama/core";
import { readRecord } from "../shared";

const NAKAMA_MCP_PREFIX = "mcp__nakama__";

/** Claude's built-in tools, mapped to the names Nakama's step cards already know. */
const BUILT_IN_TOOLS = new Map([
  ["Bash", "bash"],
  ["Edit", "edit_file"],
  ["Glob", "search_files"],
  ["Grep", "search_files"],
  ["Read", "read_file"],
  ["Write", "write_file"],
]);

interface ToolRecord {
  input: Record<string, JsonValue>;
  started: boolean;
  /** Text the agent wrote before this step, so the step can be saved after it. */
  textBefore: string;
  tool: string;
}

/**
 * Turns the ACP `session/update` stream into the handler calls the chat loop
 * already renders. The agent names a tool in `_meta.claudeCode.toolName`
 * (for example `mcp__nakama__read_file` or `Bash`), and its input often arrives
 * on a later update, so a step starts once its input is known.
 */
export function createAcpUpdateMapper(handlers: StreamChatHandlers) {
  const tools = new Map<string, ToolRecord>();

  const completed: Array<{
    call: ToolCall;
    result: unknown;
    textBefore: string;
  }> = [];

  let assistantText = "";
  // Text since the last tool step. The final answer is what is left after the last step.
  let segmentText = "";

  function start(toolCallId: string, record: ToolRecord): void {
    if (record.started) {
      return;
    }

    record.started = true;
    record.textBefore = segmentText;
    segmentText = "";
    handlers.onToolStart?.({
      input: record.input,
      tool: record.tool,
      toolCallId,
    });
  }

  function remember(update: acp.ToolCall | acp.ToolCallUpdate): ToolRecord {
    const record = tools.get(update.toolCallId) ?? {
      input: {},
      started: false,
      textBefore: "",
      tool: "tool",
    };

    const acpName = claudeToolName(update) ?? update.title ?? record.tool;
    record.tool = toNakamaToolName(acpName);

    const input = readRecord(update.rawInput);

    if (Object.keys(input).length > 0) {
      record.input = toNakamaInput(record.tool, input);
    }

    tools.set(update.toolCallId, record);

    return record;
  }

  return {
    assistantText: () => assistantText,

    completedToolCalls: () => completed,

    finalText: () => segmentText,

    handle(notification: acp.SessionNotification): void {
      const update = notification.update;

      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          if (update.content.type !== "text") {
            return;
          }

          assistantText += update.content.text;
          segmentText += update.content.text;
          handlers.onChunk(update.content.text);

          return;
        }

        case "agent_thought_chunk": {
          if (update.content.type === "text") {
            handlers.onThinking?.(update.content.text);
          }

          return;
        }

        case "tool_call": {
          const record = remember(update);

          if (Object.keys(record.input).length > 0) {
            start(update.toolCallId, record);
          }

          return;
        }

        case "tool_call_update": {
          const record = remember(update);

          if (Object.keys(record.input).length > 0) {
            start(update.toolCallId, record);
          }

          if (update.status !== "completed" && update.status !== "failed") {
            return;
          }

          start(update.toolCallId, record);

          const result = update.rawOutput ?? update.content ?? null;

          handlers.onToolEnd?.({
            result,
            tool: record.tool,
            toolCallId: update.toolCallId,
          });

          completed.push({
            call: {
              arguments: record.input,
              id: update.toolCallId,
              name: record.tool,
            },
            result,
            textBefore: record.textBefore,
          });

          tools.delete(update.toolCallId);

          return;
        }

        default:
          return;
      }
    },
  };
}

function claudeToolName(
  update: acp.ToolCall | acp.ToolCallUpdate
): string | null {
  const claude = readRecord(readRecord(update._meta).claudeCode);
  const name = claude.toolName;

  return name ? String(name) : null;
}

function toNakamaToolName(acpName: string): string {
  if (acpName.startsWith(NAKAMA_MCP_PREFIX)) {
    return acpName.slice(NAKAMA_MCP_PREFIX.length);
  }

  return BUILT_IN_TOOLS.get(acpName) ?? acpName;
}

/** Renames the agent's input keys to the ones Nakama's cards read. Other keys are kept. */
function toNakamaInput(tool: string, input: Record<string, JsonValue>) {
  const filePath = input.file_path;
  const pattern = input.pattern;

  if (
    tool === "read_file" &&
    input.path === undefined &&
    filePath !== undefined
  ) {
    const renamed = { ...input, path: filePath };

    return renamed;
  }

  if (
    tool === "search_files" &&
    input.query === undefined &&
    pattern !== undefined
  ) {
    const renamed = { ...input, query: pattern };

    return renamed;
  }

  return input;
}
