import {
  AGENT_CHANNELS,
  type AgentChannel,
  type JsonValue,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { z } from "zod";
import type { AgentService } from "../services/agent-service";

/** Tool-side default when the model omits channel; HTTP list requires an explicit channel. */
const DEFAULT_CHANNEL: AgentChannel = "web";

const DEFAULT_LIMIT = 50;

const MAX_LIMIT = 200;

const ListSessionsInputSchema = z.object({
  channel: z.string().optional().catch(undefined),
  profileId: z.string().optional().catch(undefined),
});

const ReadSessionInputSchema = z.object({
  limit: z.number().optional().catch(undefined),
  offset: z.number().optional().catch(undefined),
  sessionId: z.string().optional().catch(undefined),
});

const JsonValueSchema = z.json();

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();

  if (!orgId) {
    throw new Error("Organization context is required.");
  }

  return orgId;
}

function readChannel(value: string | undefined): AgentChannel {
  if (!value) {
    return DEFAULT_CHANNEL;
  }

  const channel = z.enum(AGENT_CHANNELS).safeParse(value);

  if (!channel.success) {
    throw new Error(`Unknown channel: ${value}.`);
  }

  return channel.data;
}

function readBoundedInteger(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

// A bare artifacts/ path resolves against the chat profile, so a path read out of
// another profile's transcript has to carry its owner or the link opens the wrong
// workspace (#1011). Absolute paths already contain /profiles/<id>/ and are left alone.
const BARE_ARTIFACT_PATH = /(^|[^\w/.-])artifacts\//g;

function qualifyArtifactPaths(
  value: JsonValue,
  ownerProfileId: string
): JsonValue {
  const stringValue = z.string().safeParse(value);

  if (stringValue.success) {
    return stringValue.data.replace(
      BARE_ARTIFACT_PATH,
      `$1profiles/${ownerProfileId}/artifacts/`
    );
  }

  const arrayValue = z.array(JsonValueSchema).safeParse(value);

  if (arrayValue.success) {
    return arrayValue.data.map((item) =>
      qualifyArtifactPaths(item, ownerProfileId)
    );
  }

  const objectValue = z.record(z.string(), JsonValueSchema).safeParse(value);

  if (objectValue.success) {
    return Object.fromEntries(
      Object.entries(objectValue.data).map(([key, item]) => [
        key,
        qualifyArtifactPaths(item, ownerProfileId),
      ])
    );
  }

  return value;
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
        const parsedInput = ListSessionsInputSchema.parse(input);
        const orgId = requireOrgId(context);
        const profileId = parsedInput.profileId?.trim();

        if (!profileId) {
          throw new Error("profileId is required.");
        }

        return await agent.listSessions(
          orgId,
          profileId,
          readChannel(parsedInput.channel),
          {
            isPlatformAdmin: context.isPlatformAdmin,
            orgRole: context.orgRole,
          }
        );
      },
    },
    {
      description:
        "Read the stored transcript of a session belonging to another agent profile in this organization. Returns messages as they were persisted, so a session with a turn still running is returned as of its last completed turn. Sessions outside this organization are not readable. Artifact paths from another profile come back as profiles/<profileId>/artifacts/...; keep that prefix when you mention one so the user can open it.",
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
        const parsedInput = ReadSessionInputSchema.parse(input);
        const orgId = requireOrgId(context);
        const sessionId = parsedInput.sessionId?.trim();

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
          parsedInput.limit,
          DEFAULT_LIMIT,
          MAX_LIMIT
        );

        const offset = readBoundedInteger(
          parsedInput.offset,
          0,
          Number.MAX_SAFE_INTEGER
        );

        const page = result.messages.slice(offset, offset + limit);

        const messages =
          result.profileId === context.profileId?.trim()
            ? page
            : page.map((message) =>
                qualifyArtifactPaths(
                  JsonValueSchema.parse(message),
                  result.profileId
                )
              );

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
