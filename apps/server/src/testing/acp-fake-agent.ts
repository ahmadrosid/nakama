/**
 * Minimal ACP agent for tests. Run it as a child process over stdio:
 *   bun apps/server/src/testing/acp-fake-agent.ts
 *
 * Prompt text picks the behavior:
 *   - "tool"  sends a tool_call and a completed tool_call_update first
 *   - "mcp-tools" asks the Nakama MCP endpoint for its tools and reports them
 *   - "mcp"   reports how many MCP servers the session was created with
 *   - "thought" sends a thought chunk before the reply
 *   - anything else echoes the prompt back
 */
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

/** Settings every session starts with. "fake-smart" tags replies so tests can see the choice. */
function initialConfigOptions(): acp.SessionConfigOption[] {
  return [
    {
      category: "model",
      currentValue: "fake-fast",
      id: "model",
      name: "Model",
      options: [
        { name: "Fast", value: "fake-fast" },
        { name: "Smart", value: "fake-smart" },
      ],
      type: "select",
    },
    {
      category: "thought_level",
      currentValue: "low",
      id: "effort",
      name: "Reasoning effort",
      options: [
        { name: "Low", value: "low" },
        { name: "High", value: "high" },
      ],
      type: "select",
    },
  ];
}

class FakeAgent implements acp.Agent {
  private mcpServerCount = 0;
  private mcpUrl = "";
  private configOptions = initialConfigOptions();
  private readonly sessionIds: string[] = [];

  constructor(private readonly connection: acp.AgentSideConnection) {}

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      agentCapabilities: {},
      authMethods: [],
      protocolVersion: acp.PROTOCOL_VERSION,
    };
  }

  async newSession(
    params: acp.NewSessionRequest
  ): Promise<acp.NewSessionResponse> {
    this.mcpServerCount = params.mcpServers.length;
    this.mcpUrl =
      params.mcpServers
        .flatMap((server) => ("env" in server ? server.env : []))
        .find((variable) => variable.name === "NAKAMA_ACP_MCP_URL")?.value ??
      "";
    const sessionId = `session-${this.sessionIds.length + 1}`;
    this.sessionIds.push(sessionId);

    return { configOptions: this.configOptions, sessionId };
  }

  async authenticate(): Promise<acp.AuthenticateResponse> {
    return {};
  }

  async setSessionConfigOption(
    params: acp.SetSessionConfigOptionRequest
  ): Promise<acp.SetSessionConfigOptionResponse> {
    this.configOptions = this.configOptions.map((option) =>
      option.id === params.configId && option.type === "select"
        ? { ...option, currentValue: String(params.value) }
        : option
    );

    return { configOptions: this.configOptions };
  }

  private currentModel(): string {
    const model = this.configOptions.find((option) => option.id === "model");

    return model?.type === "select" ? String(model.currentValue) : "";
  }

  /** What a real agent sees: the tool list its MCP endpoint serves. */
  private async listMcpTools(): Promise<string> {
    const response = await fetch(this.mcpUrl, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      return `mcp error: ${response.status}`;
    }

    // SAFETY: A 2xx tools/list reply is { result: { tools } }.
    const body = (await response.json()) as {
      result: { tools: { name: string }[] };
    };

    return `mcp tools: ${body.result.tools.map((tool) => tool.name).join(",")}`;
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const text = params.prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    if (text.includes("thought")) {
      await this.send(params.sessionId, {
        content: { text: "thinking about it", type: "text" },
        sessionUpdate: "agent_thought_chunk",
      });
    }

    if (text.includes("tool")) {
      await this.send(params.sessionId, {
        rawInput: { query: "notes" },
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "search_files",
        toolCallId: "call-1",
      });
      await this.send(params.sessionId, {
        rawOutput: { matches: 2 },
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "call-1",
      });
    }

    const modelTag = this.currentModel() === "fake-smart" ? "[smart] " : "";

    const reply = text.includes("mcp-tools")
      ? await this.listMcpTools()
      : text.includes("mcp")
        ? `mcp servers: ${this.mcpServerCount}`
        : `${modelTag}fake: ${text}`;

    await this.send(params.sessionId, {
      content: { text: reply, type: "text" },
      sessionUpdate: "agent_message_chunk",
    });

    return { stopReason: "end_turn" };
  }

  async cancel(): Promise<void> {
    // Nothing to stop: the fake agent answers each prompt before returning.
  }

  private async send(
    sessionId: string,
    update: acp.SessionUpdate
  ): Promise<void> {
    await this.connection.sessionUpdate({ sessionId, update });
  }
}

// SAFETY: Node's byte stream implements the SDK's DOM stream contract; only reader overload declarations differ.
const stdin = Readable.toWeb(process.stdin) as ReturnType<
  typeof Readable.toWeb
> &
  ReadableStream<Uint8Array>;

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), stdin);

new acp.AgentSideConnection((connection) => new FakeAgent(connection), stream);
