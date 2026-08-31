import {
  generateSkillPostTurnReview,
  type SkillPostTurnReviewOutcome,
} from "@nakama/agent";
import {
  type AgentChannel,
  type ChatMessage,
  extractLatestTurnMessages,
  parseAgentChannel,
  resolveSkillPostTurnReviewEnabled,
  type UserConfig,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { createProviderForInstance } from "../providers/create";
import { resolveProfileProviderSelection } from "./provider-instance-helpers";

/**
 * Which channels run the post-turn skill review. Total over `AgentChannel`, so
 * a new channel fails the typecheck here and has to be decided. #213 was this
 * gate: it shipped as `channel !== "web" && channel !== "cli"`, and Discord,
 * Telegram and WhatsApp skipped the review for six days without a signal.
 */
const POST_TURN_REVIEW_CHANNELS = {
  automation: false,
  cli: true,
  discord: true,
  subagent: false,
  task: false,
  telegram: true,
  web: true,
  whatsapp: true,
} as const satisfies Record<AgentChannel, boolean>;

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
  hasToolError: boolean;
  reason?: PostTurnReviewSkipReason;
  toolCallCount: number;
  usedSkillManage: boolean;
}

export interface PostTurnReviewRunnerContext {
  messages: ChatMessage[];
  orgId: string;
  profileId: string;
  sessionId: string;
  turnMessages: ChatMessage[];
  userId: string | null;
}

export type PostTurnReviewRunner = (
  context: PostTurnReviewRunnerContext
) => Promise<SkillPostTurnReviewOutcome | void>;

function countToolCallsInTurn(turnMessages: ChatMessage[]): number {
  let count = 0;
  for (const message of turnMessages) {
    if (message.role === "assistant" && message.toolCalls) {
      count += message.toolCalls.length;
    }
  }
  return count;
}

function turnHasToolError(turnMessages: ChatMessage[]): boolean {
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

function turnUsedSkillManage(turnMessages: ChatMessage[]): boolean {
  for (const message of turnMessages) {
    if (
      message.role === "assistant" &&
      message.toolCalls &&
      message.toolCalls.some((call) => call.name === SKILL_MANAGE_TOOL_NAME)
    ) {
      return true;
    }
    if (message.role === "tool" && message.name === SKILL_MANAGE_TOOL_NAME) {
      return true;
    }
  }
  return false;
}

export function evaluatePostTurnReviewTurnEligibility(
  turnMessages: ChatMessage[]
): PostTurnReviewEligibility {
  const toolCallCount = countToolCallsInTurn(turnMessages);
  const hasToolError = turnHasToolError(turnMessages);
  const usedSkillManage = turnUsedSkillManage(turnMessages);

  if (usedSkillManage) {
    return {
      eligible: false,
      hasToolError,
      reason: "skill_manage_already_used",
      toolCallCount,
      usedSkillManage,
    };
  }

  const complex =
    toolCallCount >= MIN_TOOL_CALLS_FOR_COMPLEX_TURN || hasToolError;
  if (!complex) {
    return {
      eligible: false,
      hasToolError,
      reason: "turn_not_complex",
      toolCallCount,
      usedSkillManage,
    };
  }

  return {
    eligible: true,
    hasToolError,
    toolCallCount,
    usedSkillManage,
  };
}

export class SkillPostTurnReviewService {
  private readonly inFlight = new Set<string>();
  private runner: PostTurnReviewRunner;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly getUserConfig: () => UserConfig | null,
    runner?: PostTurnReviewRunner
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
    context: PostTurnReviewRunnerContext
  ): Promise<SkillPostTurnReviewOutcome> {
    const provider = await this.resolveProviderForProfile(context.profileId);
    if (!provider) {
      return { action: "noop", reason: "provider_unavailable" };
    }

    const assigned = await this.db.listSkillsForProfile(context.profileId);
    const catalog = assigned.map((skill) => ({
      description: skill.description,
      name: skill.name,
    }));

    return generateSkillPostTurnReview({
      catalog,
      provider,
      turnMessages: context.turnMessages,
    });
  }

  async runPostTurnSkillReview(
    sessionId: string
  ): Promise<PostTurnReviewSkipReason | "ran"> {
    if (this.inFlight.has(sessionId)) {
      return "in_flight";
    }

    this.inFlight.add(sessionId);

    try {
      const session = await this.db.getSession(sessionId);
      if (!session) {
        return "session_missing";
      }

      // The session row keeps `channel` as a string, so an unknown value is
      // narrowed away here and skips the review exactly as it did before.
      const channel = parseAgentChannel(session.channel);
      if (!(channel && POST_TURN_REVIEW_CHANNELS[channel])) {
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
      const messages = storedMessages.map(
        (record) => record.payload as ChatMessage
      );
      const turnMessages = extractLatestTurnMessages(messages);
      const eligibility = evaluatePostTurnReviewTurnEligibility(turnMessages);
      if (!eligibility.eligible) {
        return eligibility.reason ?? "turn_not_complex";
      }

      await this.runner({
        messages,
        orgId: profile.orgId,
        profileId: profile.id,
        sessionId,
        turnMessages,
        userId: session.userId ?? null,
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
      defaultProviderId: userConfig.defaultProviderId,
      profileModel: profile.model,
      providers: userConfig.providers,
    });

    if (!selection) {
      return null;
    }

    return createProviderForInstance(selection.instance, selection.model);
  }
}
