import type { JsonSchema, ToolContext, ToolDefinition } from "@nakama/core";
import { emptyObjectSchema, validateImageAttachments } from "@nakama/core";
import type { DatabaseAdapter, StoredMcpServerRecord } from "@nakama/db";
import { isJsonSchema } from "./custom-tool-shared";
import type { McpToolArguments } from "./mcp-client-manager";
import { parseMcpToolArguments } from "./mcp-client-manager";
import type { McpService } from "./mcp-service";

const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const CURRENT_CHAT_CONTEXT = "x-nakama-context";

export function buildMcpToolDefinitions(
  servers: StoredMcpServerRecord[],
  mcpService: Pick<McpService, "callTool">,
  db: Pick<DatabaseAdapter, "getMcpServer">,
  orgId: string,
  profileId: string
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (const server of servers) {
    if (!server.enabled) {
      continue;
    }

    for (const cachedTool of server.cachedTools) {
      const name = uniqueLlmToolName(
        namespacedMcpToolName(server.name, cachedTool.name),
        usedNames
      );

      usedNames.add(name);
      const inputSchema = toJsonSchema(cachedTool.inputSchema);
      const hasCurrentChatContext = isCurrentChatContext(inputSchema);

      tools.push({
        description: cachedTool.description,
        name,
        parameters: hasCurrentChatContext
          ? withoutNakamaContext(inputSchema)
          : inputSchema,
        async run(input, context) {
          try {
            const currentServer = await db.getMcpServer(server.id);

            if (!currentServer?.enabled) {
              return {
                error: `MCP server "${server.name}" is disabled.`,
              };
            }

            const parsedInput = parseMcpToolArguments(input);

            const arguments_ = hasCurrentChatContext
              ? await withCurrentChatContext(parsedInput, context)
              : parsedInput;

            return await mcpService.callTool(
              currentServer,
              cachedTool.name,
              arguments_,
              orgId,
              profileId
            );
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
    }
  }

  return tools;
}

function isCurrentChatContext(schema: JsonSchema): boolean {
  const property = schema.properties?.nakamaContext;
  const metadata = property ? new Map(Object.entries(property)) : undefined;

  return (
    metadata?.get(CURRENT_CHAT_CONTEXT) === "current-chat" &&
    !(schema.required ?? []).includes("nakamaContext")
  );
}

function withoutNakamaContext(schema: JsonSchema): JsonSchema {
  const { nakamaContext: _context, ...properties } = schema.properties ?? {};

  return { ...schema, properties };
}

async function withCurrentChatContext(
  input: McpToolArguments,
  context: ToolContext
): Promise<McpToolArguments> {
  const args = { ...input };

  delete args.nakamaContext;

  const images: Array<{ data: string; mediaType: string }> = [];

  for (const image of context.currentChatImages ?? []) {
    const loaded = await context.loadAttachment?.(image.attachmentId);

    if (!loaded) {
      throw new Error(`Image attachment not found: ${image.attachmentId}`);
    }

    images.push({
      data: loaded.bytes.toString("base64"),
      mediaType: loaded.mediaType,
    });
  }

  validateImageAttachments(images);

  if (images.length || context.whatsappMessage) {
    const currentContext: McpToolArguments = {};

    if (images.length) {
      currentContext.images = images;
    }

    if (context.whatsappMessage) {
      currentContext.whatsapp = context.whatsappMessage;
    }

    args.nakamaContext = currentContext;
  }

  return args;
}

export function sanitizeLlmToolNamePart(name: string): string {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "tool";
}

export function namespacedMcpToolName(
  serverName: string,
  toolName: string
): string {
  return `${sanitizeLlmToolNamePart(serverName)}__${sanitizeLlmToolNamePart(toolName)}`;
}

export function isValidLlmToolName(name: string): boolean {
  return LLM_TOOL_NAME_PATTERN.test(name);
}

function uniqueLlmToolName(base: string, usedNames: Set<string>): string {
  if (!usedNames.has(base)) {
    return base;
  }

  let suffix = 2;

  while (usedNames.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}

function toJsonSchema<T>(inputSchema: T): JsonSchema {
  return isJsonSchema(inputSchema) ? inputSchema : emptyObjectSchema();
}
