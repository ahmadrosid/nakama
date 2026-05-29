import type { AutomationDefinition, ToolDefinition } from "@tinyclaw/core";
import {
  createAgentChatSession,
  type AgentChatSession,
  type AgentChatSessionOptions,
  type AgentDependencies,
  type AgentRequest,
} from "./chat";
import { createFallbackAutomation } from "./fallback";
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
        return createFallbackAutomation({
          prompt: request.prompt,
          tools,
        });
      }

      try {
        const raw = await dependencies.provider.generateText({
          system: buildAutomationSystemPrompt(tools),
          prompt: buildAutomationUserPrompt(request.prompt, request.channel),
        });

        return parseAutomationResponse(raw, {
          prompt: request.prompt,
          tools,
        });
      } catch {
        return createFallbackAutomation({
          prompt: request.prompt,
          tools,
        });
      }
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
} from "./chat";
export type { CompactionConfig } from "./history-compaction";
export type { AutomationStore } from "./automation/storage/db";
export type { DraftTaskPromptInput } from "./task-prompt";
export { draftTaskPromptFromFields } from "./task-prompt";
export {
  DatabaseAutomationStore,
} from "./automation/storage/db";
export {
  resolveScheduleTimezone,
  validateAutomationInput,
} from "./automation/validate";
