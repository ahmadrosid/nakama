import {
  createSmtpSender,
  type EmailOutboundAdapter,
  isEmailConfigComplete,
  loadEmailConfig,
  toMailboxConfig,
} from "@nakama/core";
import type {
  CachedMcpTool,
  DatabaseAdapter,
  StoredMcpServerRecord,
} from "@nakama/db";
import type { JsonValue, McpToolArguments } from "./mcp-client-manager";
import type { McpService } from "./mcp-service";

interface McpEmailTarget {
  server: StoredMcpServerRecord;
  tool: CachedMcpTool;
}

interface McpEmailDeliveryDependencies {
  loadConfig?: typeof loadEmailConfig;
}

const RECIPIENT_FIELD_ALIASES = [
  "to",
  "recipient",
  "recipientEmail",
  "recipient_email",
  "toEmail",
  "to_email",
  "email",
  "emailAddress",
  "email_address",
  "address",
  "recipients",
  "emails",
];

const SUBJECT_FIELD_ALIASES = ["subject", "title"];

const BODY_FIELD_ALIASES = [
  "body",
  "text",
  "message",
  "content",
  "plainText",
  "plain_text",
  "messageBody",
  "message_body",
  "bodyText",
  "body_text",
  "html",
  "htmlBody",
  "html_body",
];

export async function hasAutomationEmailDeliveryPath(
  db: DatabaseAdapter,
  profileId: string,
  dependencies: McpEmailDeliveryDependencies = {}
): Promise<boolean> {
  const loadConfig = dependencies.loadConfig ?? loadEmailConfig;

  if (isEmailConfigComplete(await loadConfig())) {
    return true;
  }

  return (await findProfileMcpEmailTarget(db, profileId)) !== null;
}

export function createMcpAwareEmailOutboundAdapter(
  db: DatabaseAdapter,
  mcpService: Pick<McpService, "callTool">,
  dependencies: McpEmailDeliveryDependencies = {}
): EmailOutboundAdapter {
  return {
    async send(input) {
      try {
        const loadConfig = dependencies.loadConfig ?? loadEmailConfig;
        const config = await loadConfig();

        if (isEmailConfigComplete(config)) {
          const sender = createSmtpSender(toMailboxConfig(config));
          await sender.send({
            subject: input.subject,
            text: input.text,
            to: input.to,
          });

          return { ok: true };
        }

        if (!input.profileId) {
          return { error: "Email is not configured.", ok: false };
        }

        const target = await findProfileMcpEmailTarget(db, input.profileId);

        if (!target) {
          return { error: "Email is not configured.", ok: false };
        }

        const result = await mcpService.callTool(
          target.server,
          target.tool.name,
          buildToolArguments(target.tool, input),
          input.orgId ?? undefined,
          input.profileId
        );

        if (isErrorResult(result)) {
          return { error: result.error, ok: false };
        }

        return { ok: true };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
    },
  };
}

async function findProfileMcpEmailTarget(
  db: DatabaseAdapter,
  profileId: string
): Promise<McpEmailTarget | null> {
  const servers = await db.listMcpServersForProfile(profileId);

  return findBestMcpEmailTarget(servers);
}

function findBestMcpEmailTarget(
  servers: StoredMcpServerRecord[]
): McpEmailTarget | null {
  let best: (McpEmailTarget & { score: number }) | null = null;

  for (const server of servers) {
    for (const tool of server.cachedTools) {
      const score = scoreEmailTool(server, tool);

      if (score <= 0) {
        continue;
      }

      if (!best || score > best.score) {
        best = { score, server, tool };
      }
    }
  }

  return best ? { server: best.server, tool: best.tool } : null;
}

function scoreEmailTool(
  server: StoredMcpServerRecord,
  tool: CachedMcpTool
): number {
  const serverText = `${server.name} ${server.transport}`.toLowerCase();
  const toolText = `${tool.name} ${tool.description}`.toLowerCase();
  const properties = readSchemaProperties(tool.inputSchema);

  const sendLike = /(send|draft|compose)/.test(toolText);
  const emailLike = /(email|gmail|mail)/.test(toolText);

  if (!(sendLike && emailLike)) {
    return 0;
  }

  let score = 10;

  if (serverText.includes("composeio")) {
    score += 30;
  }

  if (toolText.includes("gmail")) {
    score += 10;
  }

  if (toolText.includes("send_email") || toolText.includes("send email")) {
    score += 10;
  }

  if (properties) {
    const recipientField = findSchemaKey(properties, RECIPIENT_FIELD_ALIASES);
    const bodyField = findSchemaKey(properties, BODY_FIELD_ALIASES);
    const subjectField = findSchemaKey(properties, SUBJECT_FIELD_ALIASES);

    if (recipientField) {
      score += 15;
    }

    if (bodyField) {
      score += 15;
    }

    if (subjectField) {
      score += 5;
    }
  }

  return score;
}

function buildToolArguments(
  tool: CachedMcpTool,
  input: { to: string; subject: string; text: string }
): McpToolArguments {
  const properties = readSchemaProperties(tool.inputSchema);

  if (properties) {
    const args: McpToolArguments = {};

    assignSchemaValue(args, properties, RECIPIENT_FIELD_ALIASES, input.to);
    assignSchemaValue(args, properties, SUBJECT_FIELD_ALIASES, input.subject);
    assignSchemaValue(args, properties, BODY_FIELD_ALIASES, input.text);

    if (Object.keys(args).length > 0) {
      return args;
    }
  }

  return {
    body: input.text,
    subject: input.subject,
    to: input.to,
  };
}

function readSchemaProperties<T>(
  inputSchema: T
): Map<string, JsonValue> | null {
  const schema = readJsonObject(inputSchema);
  const properties = schema?.get("properties");

  return properties ? readJsonObject(properties) : null;
}

function assignSchemaValue(
  target: McpToolArguments,
  properties: Map<string, JsonValue>,
  candidates: string[],
  value: string
): void {
  const match = findSchemaKey(properties, candidates);

  if (!match) {
    return;
  }

  target[match] = schemaExpectsArray(properties.get(match)) ? [value] : value;
}

function schemaExpectsArray<T>(schema: T): boolean {
  return readJsonObject(schema)?.get("type") === "array";
}

function findSchemaKey(
  properties: Map<string, JsonValue>,
  candidates: string[]
): string | undefined {
  const normalizedCandidates = candidates.map(normalizeKey);

  return [...properties.keys()].find((key) =>
    normalizedCandidates.includes(normalizeKey(key))
  );
}

function isErrorResult<T>(value: T): value is T & { error: string } {
  const record = readJsonObject(value);
  const error = record?.get("error");

  return isString(error) && error.trim().length > 0;
}

function readJsonObject<T>(value: T): Map<string, JsonValue> | null {
  if (!(value instanceof Object)) {
    return null;
  }

  const entries = Object.entries(value);
  const parsed: Array<[string, JsonValue]> = [];

  for (const [key, entry] of entries) {
    const result = parseJsonValue(entry);

    if (result === undefined) {
      return null;
    }

    parsed.push([key, result]);
  }

  return new Map(parsed);
}

function parseJsonValue<T>(value: T): JsonValue | undefined {
  if (
    value === null ||
    Object.prototype.toString.call(value) === "[object String]" ||
    Object.prototype.toString.call(value) === "[object Number]" ||
    Object.prototype.toString.call(value) === "[object Boolean]"
  ) {
    // SAFETY: The accepted primitive tags match JsonValue's scalar members.
    return value as JsonValue;
  }

  if (Array.isArray(value)) {
    const values = value.map(parseJsonValue);

    if (values.some((entry) => entry === undefined)) {
      return;
    }

    // SAFETY: The check above excludes every undefined parse result.
    return values as JsonValue[];
  }

  if (value instanceof Object) {
    const object = readJsonObject(value);

    return object ? Object.fromEntries(object) : undefined;
  }

  return undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
