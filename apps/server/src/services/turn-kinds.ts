import type { AgentChannel } from "@nakama/core";
import { SKILL_MANAGE_CHANNELS } from "../tools/skill-manage-tool";
import type { SessionKind } from "./session-runtime";

/** Every kind of turn an agent takes, in a session or outside one. */
export type TurnKind =
  | SessionKind
  | "acp_draft"
  | "automation"
  | "group_member"
  | "plugin_summarize"
  | "plugin_workflow"
  | "sub_agent";

/** Turns that run once, outside a session. */
export type OneShotKind = Extract<
  TurnKind,
  "automation" | "group_member" | "plugin_summarize" | "sub_agent"
>;

interface TurnPolicy {
  /** Depth a session turn's tools see; a one-shot turn takes its caller's. */
  agentDepth?: number;
  /** One-shot turns set it; a session uses its own channel. */
  channel?: Extract<AgentChannel, "automation" | "subagent">;
  /** Lines added after the profile's system prompt. */
  instructions: readonly string[];
  /** Unattended one-shot turns act as a member, whoever set them up. */
  orgRole?: "member";
  /**
   * Platform tool groups on top of the profile's own; null for a turn that
   * runs without tools.
   */
  tools: {
    automation: boolean;
    /** Search-only MCP listing, when the instance turns discovery on. */
    mcpDiscovery: boolean;
    memoryWrite: boolean;
    question: boolean;
    skillManage: boolean | "by_channel";
    subAgent: boolean;
    todo: boolean;
  } | null;
}

const SUB_AGENT_INSTRUCTIONS = [
  "You are running as a focused sub-agent delegated from a parent conversation.",
  "Complete the assigned task and return a clear final answer.",
  "Do not spawn sub-agents.",
];

const GROUP_MEMBER_INSTRUCTIONS = [
  "You are taking a turn in a group chat with the user and other agents.",
  "Follow the turn's instructions and reply as yourself.",
  "Do not spawn sub-agents.",
];

const ALL_TOOLS = {
  automation: true,
  mcpDiscovery: true,
  memoryWrite: true,
  question: true,
  skillManage: "by_channel",
  subAgent: true,
  todo: true,
} as const;

/**
 * A turn nobody watches gets no planning, questions or nested agents.
 * Automations and plugin workflows still turn questions and sub_agent on.
 */
const DELEGATED_TOOLS = {
  automation: false,
  mcpDiscovery: false,
  memoryWrite: true,
  question: false,
  skillManage: false,
  subAgent: false,
  todo: false,
} as const;

const TURN_POLICIES: Record<TurnKind, TurnPolicy> = {
  // Builds the ACP agent's MCP tool list before any chat exists.
  acp_draft: {
    instructions: [],
    tools: { ...ALL_TOOLS, mcpDiscovery: false, skillManage: true },
  },
  automation: {
    channel: "automation",
    instructions: [],
    orgRole: "member",
    tools: {
      ...DELEGATED_TOOLS,
      question: true,
      subAgent: true,
    },
  },
  branch: { instructions: [], tools: ALL_TOOLS },
  chat: { instructions: [], tools: ALL_TOOLS },
  child: {
    agentDepth: 1,
    instructions: SUB_AGENT_INSTRUCTIONS,
    tools: { ...DELEGATED_TOOLS, mcpDiscovery: true },
  },
  // Nothing leaves a cognito chat: no org memory proposals, no skill writes.
  cognito: {
    instructions: [],
    tools: { ...ALL_TOOLS, memoryWrite: false, skillManage: false },
  },
  group_member: {
    channel: "subagent",
    instructions: GROUP_MEMBER_INSTRUCTIONS,
    tools: DELEGATED_TOOLS,
  },
  plugin_summarize: {
    channel: "automation",
    instructions: [],
    orgRole: "member",
    tools: null,
  },
  plugin_workflow: {
    instructions: [],
    tools: {
      ...DELEGATED_TOOLS,
      question: true,
      subAgent: true,
    },
  },
  sub_agent: {
    channel: "subagent",
    instructions: SUB_AGENT_INSTRUCTIONS,
    tools: DELEGATED_TOOLS,
  },
};

/** What a turn of this kind may use and is told, on the given channel. */
export function turnPolicy(kind: TurnKind, channel?: AgentChannel) {
  const { tools, ...policy } = TURN_POLICIES[kind];

  return {
    ...policy,
    tools: tools && {
      ...tools,
      skillManage:
        tools.skillManage === "by_channel"
          ? Boolean(channel && SKILL_MANAGE_CHANNELS[channel])
          : tools.skillManage,
    },
  };
}

/** The profile's prompt with the kind's instructions after it. */
export function withTurnInstructions(
  prompt: string,
  instructions: readonly string[]
): string {
  return instructions.length > 0
    ? [prompt.trim(), "", ...instructions].join("\n")
    : prompt;
}
