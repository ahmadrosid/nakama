import type { AutomationDefinition, ToolDefinition } from "@nakama/core";
import {
  type AgentChatSession,
  type AgentChatSessionOptions,
  type AgentDependencies,
  type AgentRequest,
  createAgentChatSession,
} from "./chat";
import { parseAutomationResponse } from "./parse";
import {
  buildAutomationSystemPrompt,
  buildAutomationUserPrompt,
} from "./prompt";

export interface AgentHarness {
  createAutomationFromPrompt(
    request: AgentRequest,
    options?: { tools?: ToolDefinition[] }
  ): Promise<AutomationDefinition>;
  createChatSession(options?: AgentChatSessionOptions): AgentChatSession;
}

export function createAgentHarness(
  dependencies: AgentDependencies = {}
): AgentHarness {
  const defaultTools = dependencies.tools ?? [];
  const harness: AgentHarness = {
    async createAutomationFromPrompt(request, options) {
      const tools = options?.tools ?? defaultTools;

      if (!dependencies.provider) {
        throw new Error("Provider is not configured.");
      }

      const result = await dependencies.provider.generateText({
        prompt: buildAutomationUserPrompt(request.prompt, request.channel),
        system: buildAutomationSystemPrompt(tools),
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
export { usableContextTokens } from "./history-compaction";
export {
  buildLearnPrompt,
  expandLearnInLastUserMessage,
  tryParseLearnCommand,
} from "./learn-prompt";
export {
  buildSessionTitlePrompt,
  generateSessionTitleFromMessages,
  normalizeSessionTitle,
} from "./session-title";
export type {
  SkillConsolidateBodyInput,
  SkillConsolidateMode,
} from "./skill-consolidate";
export {
  buildSkillConsolidatePrompt,
  generateSkillConsolidateMarkdown,
} from "./skill-consolidate";
export type {
  SkillCatalogEntry,
  SkillPostTurnReviewOutcome,
} from "./skill-post-turn-review";
export {
  buildSkillPostTurnReviewPrompt,
  generateSkillPostTurnReview,
  parseSkillPostTurnReviewResponse,
} from "./skill-post-turn-review";
export { canRunToolCallsInParallel, executeToolCall } from "./tool-loop";
export {
  buildSuggestParamsUserPrompt,
  parseSuggestedParams,
  suggestToolParamsFromPrompt,
} from "./tool-playground-params";
