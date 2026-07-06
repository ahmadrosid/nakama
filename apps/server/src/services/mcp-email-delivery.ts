import {
  createSmtpSender,
  emailConfigToMailboxConfig,
  isEmailConfigComplete,
  loadEmailConfig,
  type EmailOutboundAdapter,
} from "@nakama/core";
import type { DatabaseAdapter, CachedMcpTool, StoredMcpServerRecord } from "@nakama/db";
import type { McpClientManager } from "./mcp-client-manager";

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
  dependencies: McpEmailDeliveryDependencies = {},
): Promise<boolean> {
  const loadConfig = dependencies.loadConfig ?? loadEmailConfig;

  if (isEmailConfigComplete(await loadConfig())) {
    return true;
  }

  return (await findProfileMcpEmailTarget(db, profileId)) !== null;
}

export function createMcpAwareEmailOutboundAdapter(
  db: DatabaseAdapter,
  manager: McpClientManager,
  dependencies: McpEmailDeliveryDependencies = {},
): EmailOutboundAdapter {
  return {
    async send(input) {
      try {
        const loadConfig = dependencies.loadConfig ?? loadEmailConfig;
        const config = await loadConfig();

        if (isEmailConfigComplete(config)) {
          const sender = createSmtpSender(emailConfigToMailboxConfig(config));
          await sender.send({
            to: input.to,
            subject: input.subject,
            text: input.text,
          });
          return { ok: true };
        }

        if (!input.profileId) {
          return { ok: false, error: "Email is not configured." };
        }

        const target = await findProfileMcpEmailTarget(db, input.profileId);

        if (!target) {
          return { ok: false, error: "Email is not configured." };
        }

        await ensureConnected(manager, target.server, input.orgId ?? undefined, input.profileId);
        const result = await manager.callTool(
          target.server.id,
          target.server.transport,
          target.tool.name,
          buildToolArguments(target.tool, input),
          target.server.transport === "stdio" ? input.profileId : undefined,
          target.server.transport === "stdio" ? (input.orgId ?? undefined) : undefined,
        );

        if (isErrorResult(result)) {
          return { ok: false, error: result.error };
        }

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function findProfileMcpEmailTarget(
  db: DatabaseAdapter,
  profileId: string,
): Promise<McpEmailTarget | null> {
  const servers = await db.listMcpServersForProfile(profileId);
  return findBestMcpEmailTarget(servers);
}

function findBestMcpEmailTarget(servers: StoredMcpServerRecord[]): McpEmailTarget | null {
  let best: (McpEmailTarget & { score: number }) | null = null;

  for (const server of servers) {
    for (const tool of server.cachedTools) {
      const score = scoreEmailTool(server, tool);

      if (score <= 0) {
        continue;
      }

      if (!best || score > best.score) {
        best = { server, tool, score };
      }
    }
  }

  return best ? { server: best.server, tool: best.tool } : null;
}

function scoreEmailTool(server: StoredMcpServerRecord, tool: CachedMcpTool): number {
  const serverText = `${server.name} ${server.transport}`.toLowerCase();
  const toolText = `${tool.name} ${tool.description}`.toLowerCase();
  const properties = readSchemaProperties(tool.inputSchema);

  const sendLike = /(send|draft|compose)/.test(toolText);
  const emailLike = /(email|gmail|mail)/.test(toolText);

  if (!sendLike || !emailLike) {
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

async function ensureConnected(
  manager: McpClientManager,
  server: StoredMcpServerRecord,
  orgId: string | undefined,
  profileId: string,
): Promise<void> {
  if (server.transport === "stdio") {
    if (!orgId) {
      throw new Error("Profile organization is missing for stdio MCP email delivery.");
    }

    await manager.ensureConnected(server, orgId, profileId);
    return;
  }

  if (!manager.isConnected(server.id, server.transport)) {
    await manager.connect(server);
  }
}

function buildToolArguments(
  tool: CachedMcpTool,
  input: { to: string; subject: string; text: string },
): Record<string, unknown> {
  const properties = readSchemaProperties(tool.inputSchema);

  if (properties) {
    const args: Record<string, unknown> = {};

    assignSchemaValue(args, properties, RECIPIENT_FIELD_ALIASES, input.to);
    assignSchemaValue(args, properties, SUBJECT_FIELD_ALIASES, input.subject);
    assignSchemaValue(args, properties, BODY_FIELD_ALIASES, input.text);

    if (Object.keys(args).length > 0) {
      return args;
    }
  }

  return {
    to: input.to,
    subject: input.subject,
    body: input.text,
  };
}

function readSchemaProperties(inputSchema: unknown): Record<string, unknown> | null {
  if (!isRecord(inputSchema)) {
    return null;
  }

  const properties = inputSchema.properties;
  return isRecord(properties) ? properties : null;
}

function assignSchemaValue(
  target: Record<string, unknown>,
  properties: Record<string, unknown>,
  candidates: string[],
  value: string,
): void {
  const match = findSchemaKey(properties, candidates);

  if (!match) {
    return;
  }

  target[match] = schemaExpectsArray(properties[match]) ? [value] : value;
}

function schemaExpectsArray(schema: unknown): boolean {
  return isRecord(schema) && schema.type === "array";
}

function findSchemaKey(
  properties: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const normalizedCandidates = candidates.map(normalizeKey);

  return Object.keys(properties).find((key) => normalizedCandidates.includes(normalizeKey(key)));
}

function isErrorResult(value: unknown): value is { error: string } {
  return isRecord(value) && typeof value.error === "string" && value.error.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
