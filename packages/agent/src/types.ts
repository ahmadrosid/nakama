import type { ProviderClient, ToolDefinition } from "@tinyclaw/core";

export interface AgentRequest {
  prompt: string;
  channel: "web" | "cli" | "telegram";
}

export interface AgentDependencies {
  provider?: ProviderClient;
  tools?: ToolDefinition[];
}
