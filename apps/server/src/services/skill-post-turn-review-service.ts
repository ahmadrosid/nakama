import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  generateSkillPostTurnReview,
  type SkillPostTurnReviewOutcome,
} from "@nakama/agent";
import {
  type AgentChannel,
  type ChatMessage,
  extractExplicitSkillName,
  extractLatestTurnMessages,
  getUserMessageText,
  LOAD_SKILL_TOOL_NAME,
  parseAgentChannel,
  resolveProfileOrgBooleanOverride,
  SKILL_FILE_NAME,
  type UserConfig,
} from "@nakama/core";
import { resolveProfileSkillDirectory } from "@nakama/core/skills/write";
import { comparablePath, resolveWithRealpath } from "@nakama/core/tools/paths";
import type { DatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { createProviderForProfile } from "./provider-instance-helpers";

/**
 * Which channels run the post-turn skill review. Total over `AgentChannel`, so
 * a new channel fails the typecheck here and has to be decided. This gate is
 * where #213 happened: `ae27f7b2` shipped it as
 * `channel !== "web" && channel !== "cli"`, and Discord, Telegram and WhatsApp
 * skipped the review for five days and 23 hours until `e0026ea6` (#224).
 */
const POST_TURN_REVIEW_CHANNELS = {
  automation: false,
  cli: true,
  discord: true,
  slack: true,
  subagent: false,
  task: false,
  teams: true,
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

// Only a successful load_skill result carries `name`.
const LoadSkillResultSchema = z.object({ name: z.string() });

/** Most SKILL.md bodies one review prompt carries. */
const MAX_LOADED_SKILL_BODIES = 3;

/**
 * SKILL.md of a profile-owned skill, read from the same file staging matches
 * oldString against. Undefined for a skill whose source is another directory
 * (global, bundled, or a folder name that differs from the skill name).
 */
async function readProfileSkillMarkdown(
  context: { orgId: string; profileId: string },
  skill: { name: string; sourcePath: string }
): Promise<string | undefined> {
  try {
    const directory = resolveProfileSkillDirectory(
      context.orgId,
      context.profileId,
      skill.name
    );

    if (
      comparablePath(directory) !==
      comparablePath(resolveWithRealpath(skill.sourcePath))
    ) {
      return;
    }

    return await readFile(path.join(directory, SKILL_FILE_NAME), "utf8");
  } catch {}
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
      const parsed: unknown = JSON.parse(message.content);
      const record = readRecord(parsed);

      if (record?.has("error") && record.get("error") != null) {
        return true;
      }
    } catch {
      // non-JSON tool content is not treated as an error signal
    }
  }

  return false;
}

function readRecord<T>(input: T): Map<string, unknown> | undefined {
  if (!(input instanceof Object) || Array.isArray(input)) {
    return;
  }

  return new Map(Object.entries(input));
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
    private readonly getUserConfig: () => UserConfig | null
  ) {
    this.runner = (context) => this.reviewTurnWithLlm(context);
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

    // A skill counts as loaded when a load_skill call succeeded or the user
    // named it with `/skill <name>`, in this turn or an earlier one. The Set
    // keeps the latest load last, so the cap below keeps the most recent ones.
    const loadedNames = new Set<string>();

    const markLoaded = (name: string) => {
      loadedNames.delete(name);
      loadedNames.add(name);
    };

    for (const message of context.messages) {
      if (message.role === "user") {
        const name = extractExplicitSkillName(
          getUserMessageText(message.content)
        );

        if (name) {
          markLoaded(name);
        }
      } else if (
        message.role === "tool" &&
        message.name === LOAD_SKILL_TOOL_NAME
      ) {
        // A success carries the skill's own name; a failure carries only `error`.
        try {
          const result = LoadSkillResultSchema.safeParse(
            JSON.parse(message.content)
          );

          if (result.success) {
            markLoaded(result.data.name);
          }
        } catch {
          // Not JSON, so the call returned no skill.
        }
      }
    }

    const recentNames = new Set(
      [...loadedNames].slice(-MAX_LOADED_SKILL_BODIES)
    );

    const catalog = await Promise.all(
      assigned.map(async (skill) => ({
        description: skill.description,
        name: skill.name,
        skillMarkdown: recentNames.has(skill.name)
          ? await readProfileSkillMarkdown(context, skill)
          : undefined,
      }))
    );

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

      const enabled = resolveProfileOrgBooleanOverride(
        profile.skillsPostTurnReview ?? null,
        org.skillsPostTurnReview ?? false
      );

      if (!enabled) {
        return "flag_disabled";
      }

      const assignedSkills = await this.db.listSkillsForProfile(profile.id);

      if (!assignedSkills.some((skill) => skill.name === MANAGE_SKILLS_NAME)) {
        return "manage_skills_unassigned";
      }

      const storedMessages = await this.db.listMessagesForSession(sessionId);

      const messages = storedMessages.map((record) => {
        // SAFETY: The database stores serialized ChatMessage values in this payload column.
        return record.payload as ChatMessage;
      });

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

  resolveProviderForProfile(profileId: string) {
    return createProviderForProfile(this.db, profileId, this.getUserConfig());
  }
}
