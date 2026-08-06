import {
  extractLatestTurnMessages,
  resolveSkillPostTurnReviewEnabled,
  type ChatMessage,
  type UserConfig,
} from "@nakama/core";
import {
  generateSkillPostTurnReview,
  type SkillPostTurnReviewOutcome,
} from "@nakama/agent";
import type { DatabaseAdapter } from "@nakama/db";
import { createProviderForInstance } from "../providers/create";
import { resolveProfileProviderSelection } from "./provider-instance-helpers";

const MIN_TOOL_CALLS_FOR_COMPLEX_TURN = 5;
const MANAGE_SKILLS_NAME = "manage-skills";
const SKILL_MANAGE_TOOL_NAME = "skill_manage";

export type PostTurnReviewSkipReason =
  | "in_flight"
  | "session_missing"
  | "profile_missing"
  | "org_missing"
  | "channel_not_interactive"
  | "flag_disabled"
  | "manage_skills_unassigned"
  | "turn_not_complex"
  | "skill_manage_already_used"
  | "noop";

export interface PostTurnReviewEligibility {
  eligible: boolean;
  reason?: PostTurnReviewSkipReason;
  toolCallCount: number;
  hasToolError: boolean;
  usedSkillManage: boolean;
}

export interface PostTurnReviewRunnerContext {
  sessionId: string;
  orgId: string;
  profileId: string;
  userId: string | null;
  messages: ChatMessage[];
  turnMessages: ChatMessage[];
}

export type PostTurnReviewRunner = (
  context: PostTurnReviewRunnerContext,
) => Promise<SkillPostTurnReviewOutcome | void>;

export function countToolCallsInTurn(turnMessages: ChatMessage[]): number {
  let count = 0;
  for (const message of turnMessages) {
    if (message.role === "assistant" && message.toolCalls) {
      count += message.toolCalls.length;
    }
  }
  return count;
}

export function turnHasToolError(turnMessages: ChatMessage[]): boolean {
  for (const message of turnMessages) {
    if (message.role !== "tool") {
      continue;
    }
    try {
      const parsed = JSON.parse(message.content) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        (parsed as { error: unknown }).error != null
      ) {
        return true;
      }
    } catch {
      // non-JSON tool content is not treated as an error signal
    }
  }
  return false;
}

export function turnUsedSkillManage(turnMessages: ChatMessage[]): boolean {
  for (const message of turnMessages) {
    if (message.role === "assistant" && message.toolCalls) {
      if (message.toolCalls.some((call) => call.name === SKILL_MANAGE_TOOL_NAME)) {
        return true;
      }
    }
    if (message.role === "tool" && message.name === SKILL_MANAGE_TOOL_NAME) {
      return true;
    }
  }
  return false;
}

export function evaluatePostTurnReviewTurnEligibility(
  turnMessages: ChatMessage[],
): PostTurnReviewEligibility {
  const toolCallCount = countToolCallsInTurn(turnMessages);
  const hasToolError = turnHasToolError(turnMessages);
  const usedSkillManage = turnUsedSkillManage(turnMessages);

  if (usedSkillManage) {
    return {
      eligible: false,
      reason: "skill_manage_already_used",
      toolCallCount,
      hasToolError,
      usedSkillManage,
    };
  }

  const complex = toolCallCount >= MIN_TOOL_CALLS_FOR_COMPLEX_TURN || hasToolError;
  if (!complex) {
    return {
      eligible: false,
      reason: "turn_not_complex",
      toolCallCount,
      hasToolError,
      usedSkillManage,
    };
  }

  return {
    eligible: true,
    toolCallCount,
    hasToolError,
    usedSkillManage,
  };
}

export class SkillPostTurnReviewService {
  private readonly inFlight = new Set<string>();
  private runner: PostTurnReviewRunner;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly getUserConfig: () => UserConfig | null,
    runner?: PostTurnReviewRunner,
  ) {
    this.runner = runner ?? ((context) => this.reviewTurnWithLlm(context));
  }

  /** Test/injection hook — U4 wraps this to stage/suggest after the LLM outcome. */
  setRunner(runner: PostTurnReviewRunner): void {
    this.runner = runner;
  }

  schedulePostTurnSkillReview(sessionId: string): void {
    void this.runPostTurnSkillReview(sessionId).catch((error) => {
      console.error(`Failed post-turn skill review for ${sessionId}:`, error);
    });
  }

  async reviewTurnWithLlm(
    context: PostTurnReviewRunnerContext,
  ): Promise<SkillPostTurnReviewOutcome> {
    const provider = await this.resolveProviderForProfile(context.profileId);
    if (!provider) {
      return { action: "noop", reason: "provider_unavailable" };
    }

    const assigned = await this.db.listSkillsForProfile(context.profileId);
    const catalog = assigned.map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));

    return generateSkillPostTurnReview({
      turnMessages: context.turnMessages,
      catalog,
      provider,
    });
  }

  async runPostTurnSkillReview(sessionId: string): Promise<PostTurnReviewSkipReason | "ran"> {
    if (this.inFlight.has(sessionId)) {
      return "in_flight";
    }

    this.inFlight.add(sessionId);

    try {
      const session = await this.db.getSession(sessionId);
      if (!session) {
        return "session_missing";
      }

      const channel = session.channel;
      if (channel !== "web" && channel !== "cli") {
        return "channel_not_interactive";
      }

      const profile = await this.db.getProfile(session.profileId);
      if (!profile?.orgId) {
        return "profile_missing";
      }

      const org = await this.db.getOrganizationById(profile.orgId);
      if (!org) {
        return "org_missing";
      }

      const enabled = resolveSkillPostTurnReviewEnabled({
        orgSkillsPostTurnReview: org.skillsPostTurnReview ?? false,
        profileSkillsPostTurnReview: profile.skillsPostTurnReview ?? null,
      });
      if (!enabled) {
        return "flag_disabled";
      }

      const assignedSkills = await this.db.listSkillsForProfile(profile.id);
      if (!assignedSkills.some((skill) => skill.name === MANAGE_SKILLS_NAME)) {
        return "manage_skills_unassigned";
      }

      const storedMessages = await this.db.listMessagesForSession(sessionId);
      const messages = storedMessages.map((record) => record.payload as ChatMessage);
      const turnMessages = extractLatestTurnMessages(messages);
      const eligibility = evaluatePostTurnReviewTurnEligibility(turnMessages);
      if (!eligibility.eligible) {
        return eligibility.reason ?? "turn_not_complex";
      }

      await this.runner({
        sessionId,
        orgId: profile.orgId,
        profileId: profile.id,
        userId: session.userId ?? null,
        messages,
        turnMessages,
      });

      return "ran";
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  async resolveProviderForProfile(profileId: string) {
    const userConfig = this.getUserConfig();
    if (!userConfig) {
      return null;
    }

    const profile = await this.db.getProfile(profileId);
    if (!profile) {
      return null;
    }

    const selection = resolveProfileProviderSelection({
      providers: userConfig.providers,
      defaultProviderId: userConfig.defaultProviderId,
      profileModel: profile.model,
    });

    if (!selection) {
      return null;
    }

    return createProviderForInstance(selection.instance, selection.model);
  }
}
