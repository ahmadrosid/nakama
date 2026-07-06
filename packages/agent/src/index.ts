import type { AutomationDefinition, ToolDefinition } from "@nakama/core";
import {
  createAgentChatSession,
  type AgentChatSession,
  type AgentChatSessionOptions,
  type AgentDependencies,
  type AgentRequest,
} from "./chat";
import { parseAutomationResponse } from "./parse";
import {
  buildAutomationSystemPrompt,
  buildAutomationUserPrompt,
} from "./prompt";

export interface AgentHarness {
  createAutomationFromPrompt(
    request: AgentRequest,
    options?: { tools?: ToolDefinition[] },
  ): Promise<AutomationDefinition>;
  createChatSession(options?: AgentChatSessionOptions): AgentChatSession;
}

export function createAgentHarness(
  dependencies: AgentDependencies = {},
): AgentHarness {
  const defaultTools = dependencies.tools ?? [];
  const harness: AgentHarness = {
    async createAutomationFromPrompt(request, options) {
      const tools = options?.tools ?? defaultTools;

      if (!dependencies.provider) {
        throw new Error("Provider is not configured.");
      }

      const result = await dependencies.provider.generateText({
        system: buildAutomationSystemPrompt(tools),
        prompt: buildAutomationUserPrompt(request.prompt, request.channel),
      });

      return parseAutomationResponse(result.content, {
        prompt: request.prompt,
        tools,
      });
    },
    createChatSession(options) {
      return createAgentChatSession(dependencies, harness, options);
    },
  };

  return harness;
}

export type {
  AgentChatSession,
  AgentChatSessionOptions,
  AgentDependencies,
  AgentRequest,
  ResolvePromptContextInput,
} from "./chat";
export type { CompactionConfig } from "./history-compaction";
export type { DraftTaskPromptInput } from "./task-prompt";
export { draftTaskPromptFromFields } from "./task-prompt";
export { executeToolCall } from "./tool-loop";
export {
  suggestToolParamsFromPrompt,
  parseSuggestedParams,
  buildSuggestParamsUserPrompt,
} from "./tool-playground-params";
export {
  buildSessionTitlePrompt,
  generateSessionTitleFromMessages,
  normalizeSessionTitle,
} from "./session-title";
