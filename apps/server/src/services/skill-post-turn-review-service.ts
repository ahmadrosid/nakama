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
const LoadSkillResultSchema = z.object({
  error: z.unknown().optional(),
  name: z.string().optional(),
});

const LoadSkillNameSchema = z.string().trim();

/** Most SKILL.md bodies one review prompt carries. */
const MAX_LOADED_SKILL_BODIES = 3;

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

    // Skills the session loaded, oldest first: a load_skill call that
    // succeeded, or a `/skill <name>` message, in this turn or an earlier one.
    const loads: string[] = [];

    // Compaction can replace an old tool result with plain text, so the name
    // the call asked for is the fallback when the result has no name.
    const requestedNames = new Map<string, string>();

    for (const message of context.messages) {
      if (message.role === "user") {
        const name = extractExplicitSkillName(
          getUserMessageText(message.content)
        );

        if (name) {
          loads.push(name);
        }
      } else if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) {
          if (call.name !== LOAD_SKILL_TOOL_NAME) {
            continue;
          }

          const name = LoadSkillNameSchema.safeParse(call.arguments.name);

          if (name.success) {
            requestedNames.set(call.id, name.data);
          }
        }
      } else if (
        message.role === "tool" &&
        message.name === LOAD_SKILL_TOOL_NAME
      ) {
        let result: z.infer<typeof LoadSkillResultSchema> | undefined;

        try {
          const parsed = LoadSkillResultSchema.safeParse(
            JSON.parse(message.content)
          );

          result = parsed.success ? parsed.data : undefined;
        } catch {
          // Compaction replaced the result with text.
        }

        // A failure carries only `error`; a success carries the skill's name.
        if (result?.error !== undefined) {
          continue;
        }

        const name =
          result?.name ??
          (message.toolCallId
            ? requestedNames.get(message.toolCallId)
            : undefined);

        if (name) {
          loads.push(name);
        }
      }
    }

    // Newest load first. Only a profile-owned skill can be patched, so only
    // those take a slot. The body is read from the file staging matches
    // oldString against, so a skill in another directory (global, bundled, or
    // a folder name that differs from the skill name) gets none.
    const assignedByName = new Map(
      assigned.map((skill) => [skill.name, skill])
    );

    const checked = new Set<string>();
    const bodies = new Map<string, string>();

    for (const name of [...loads].reverse()) {
      const skill = assignedByName.get(name);

      if (bodies.size >= MAX_LOADED_SKILL_BODIES) {
        break;
      }

      if (!skill || checked.has(name)) {
        continue;
      }

      checked.add(name);

      try {
        const directory = resolveProfileSkillDirectory(
          context.orgId,
          context.profileId,
          name
        );

        if (
          comparablePath(directory) ===
          comparablePath(resolveWithRealpath(skill.sourcePath))
        ) {
          bodies.set(
            name,
            await readFile(path.join(directory, SKILL_FILE_NAME), "utf8")
          );
        }
      } catch {
        // Not a profile-owned skill, or its SKILL.md is gone.
      }
    }

    const catalog = assigned.map((skill) => ({
      description: skill.description,
      name: skill.name,
      skillMarkdown: bodies.get(skill.name),
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
