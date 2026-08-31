import {
  AGENT_CHANNELS,
  type AgentChannel,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import type { AgentService } from "../services/agent-service";

/** Tool-side default when the model omits channel; HTTP list requires an explicit channel. */
const DEFAULT_CHANNEL: AgentChannel = "web";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();

  if (!orgId) {
    throw new Error("Organization context is required.");
  }

  return orgId;
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readChannel(input: unknown): AgentChannel {
  const value = readString(input, "channel");

  if (!value) {
    return DEFAULT_CHANNEL;
  }

  if (!AGENT_CHANNELS.includes(value as AgentChannel)) {
    throw new Error(`Unknown channel: ${value}.`);
  }

  return value as AgentChannel;
}

function readBoundedInteger(
  input: unknown,
  key: string,
  fallback: number,
  max: number
): number {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return fallback;
  }

  const value = (input as Record<string, unknown>)[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

export function createSessionTools(agent: AgentService): ToolDefinition[] {
  return [
    {
      description:
        "List the chat sessions of another agent profile in this organization, newest activity first. Use it to find a session id before reading its transcript. Sessions with no messages are not listed. Profiles outside this organization are not visible.",
      name: "list_profile_sessions",
      parallelSafe: true,
      parameters: {
        additionalProperties: false,
        properties: {
          channel: {
            description:
              "Which channel's sessions to list. Defaults to web when omitted.",
            enum: [...AGENT_CHANNELS],
            type: "string",
          },
          profileId: {
            description: "Id of the profile whose sessions you want to list.",
            type: "string",
          },
        },
        required: ["profileId"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const orgId = requireOrgId(context);
        const profileId = readString(input, "profileId");

        if (!profileId) {
          throw new Error("profileId is required.");
        }

        return await agent.listSessions(orgId, profileId, readChannel(input));
      },
    },
    {
      description:
        "Read the stored transcript of a session belonging to another agent profile in this organization. Returns messages as they were persisted, so a session with a turn still running is returned as of its last completed turn. Sessions outside this organization are not readable.",
      name: "read_profile_session",
      parallelSafe: true,
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description: `How many messages to return, newest last. Defaults to ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`,
            type: "number",
          },
          offset: {
            description:
              "How many messages to skip from the start of the transcript. Use it with limit to page through a long session.",
            type: "number",
          },
          sessionId: {
            description: "Id of the session to read.",
            type: "string",
          },
        },
        required: ["sessionId"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const orgId = requireOrgId(context);
        const sessionId = readString(input, "sessionId");

        if (!sessionId) {
          throw new Error("sessionId is required.");
        }

        const result = await agent.getSessionMessages(sessionId, orgId, {
          persistedOnly: true,
        });

        if (!result) {
          throw new Error("Session not found.");
        }

        const limit = readBoundedInteger(
          input,
          "limit",
          DEFAULT_LIMIT,
          MAX_LIMIT
        );
        const offset = readBoundedInteger(
          input,
          "offset",
          0,
          Number.MAX_SAFE_INTEGER
        );
        const messages = result.messages.slice(offset, offset + limit);

        return {
          channel: result.channel,
          messages,
          profileId: result.profileId,
          returnedMessages: messages.length,
          totalMessages: result.messages.length,
        };
      },
    },
  ];
}
