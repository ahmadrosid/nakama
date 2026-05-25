import type { AutomationDefinition, ToolDefinition } from "@tinyclaw/core";
import {
  createAgentChatSession,
  type AgentChatSession,
  type AgentChatSessionOptions,
} from "./chat";
import { createFallbackAutomation } from "./fallback";
import { parseAutomationResponse } from "./parse";
import {
  buildAutomationSystemPrompt,
  buildAutomationUserPrompt,
} from "./prompt";
import type { AgentDependencies, AgentRequest } from "./types";

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

export * from "./automation";
export {
  isValidCronExpression,
  resolveScheduleTimezone,
  validateAutomationInput,
  validateTimezone,
} from "./automation/validate";
export * from "./automation/validate";
export {
  createAgentChatSession,
  getLastUserMessage,
  type AgentChatSession,
  type AgentChatSessionOptions,
} from "./chat";
export { buildChatSystemPrompt } from "./chat-prompt";
export { executeToolCall, findTool, serializeToolResult } from "./tool-loop";
export { createFallbackAutomation } from "./fallback";
export { deriveName, parseAutomationResponse } from "./parse";
export {
  buildAutomationSystemPrompt,
  buildAutomationUserPrompt,
} from "./prompt";
export type { AgentDependencies, AgentRequest } from "./types";
