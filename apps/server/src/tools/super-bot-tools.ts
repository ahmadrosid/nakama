import type { ProfileService } from "../services/profile-service";
import {
  emptyObjectSchema,
  type CreateProfileRequest,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { validateJavascriptToolModule } from "../services/javascript-tool-loader";
import {
  SuperBotSessionState,
  TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE,
} from "../services/super-bot-session-state";

const SUPPORTED_SOUL_FILE_NAMES = [
  "SOUL.md",
  "STYLE.md",
  "INSTRUCTIONS.md",
  "MEMORY.md",
] as const;
type SupportedSoulFileName = (typeof SUPPORTED_SOUL_FILE_NAMES)[number];

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();

  if (!orgId) {
    throw new Error("Organization context is required.");
  }

  return orgId;
}

export function createSuperBotTools(
  profileService: ProfileService,
  sessionState: SuperBotSessionState,
): ToolDefinition[] {
  return [
    {
      name: "list_profiles",
      description:
        "List all bot profiles with their id, name, and tool counts. Use when managing profiles or when the user asks you to assign a tool and you need profile ids.",
      parameters: emptyObjectSchema(),
      async run(_input, context: ToolContext) {
        return profileService.listProfiles(requireOrgId(context));
      },
    },
    {
      name: "get_profile",
      description: "Get a bot profile by id, including assigned tools.",
      parameters: {
        type: "object",
        properties: {
          profileId: { type: "string", description: "Profile id to fetch." },
        },
        required: ["profileId"],
        additionalProperties: false,
      },
      async run(input, context: ToolContext) {
        const profileId = readString(input, "profileId");

        if (!profileId) {
          throw new Error("profileId is required.");
        }

        return profileService.getProfile(requireOrgId(context), profileId);
      },
    },
    {
      name: "create_profile",
      description: "Create a new bot profile.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional stable profile id. Auto-generated when omitted.",
          },
          name: { type: "string", description: "Display name for the profile." },
          systemPrompt: { type: "string", description: "System prompt for the bot." },
          model: {
            type: "string",
            description: "Model override, or null to use the server default.",
          },
          isSuper: {
            type: "boolean",
            description: "Whether this profile is a super bot.",
          },
          soulFiles: {
            type: "object",
            description:
              "Optional generated soul file contents for the new profile. Supported keys: SOUL.md, STYLE.md, INSTRUCTIONS.md, MEMORY.md.",
            properties: {
              "SOUL.md": { type: "string" },
              "STYLE.md": { type: "string" },
              "INSTRUCTIONS.md": { type: "string" },
              "MEMORY.md": { type: "string" },
            },
            additionalProperties: false,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      async run(input, context: ToolContext) {
        const name = readString(input, "name");

        if (!name) {
          throw new Error("name is required.");
        }

        return profileService.createProfile(requireOrgId(context), {
          id: readString(input, "id") ?? undefined,
          name,
          systemPrompt: readString(input, "systemPrompt") ?? undefined,
          model: readOptionalString(input, "model"),
          isSuper: readBoolean(input, "isSuper") ?? false,
          soulFiles: readSoulFiles(input),
        });
      },
    },
    {
      name: "assign_tool_to_profile",
      description:
        "Assign an existing tool to a profile. Use only when the user explicitly asks to assign a tool to a profile.",
      parameters: {
        type: "object",
        properties: {
          profileId: { type: "string", description: "Target profile id." },
          toolId: { type: "string", description: "Tool id to assign." },
        },
        required: ["profileId", "toolId"],
        additionalProperties: false,
      },
      async run(input, context: ToolContext) {
        const profileId = readString(input, "profileId");
        const toolId = readString(input, "toolId");

        if (!profileId || !toolId) {
          throw new Error("profileId and toolId are required.");
        }

        if (!sessionState.canAssignTool(context.sessionId, toolId)) {
          throw new Error(TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE);
        }

        const result = await profileService.assignTool(requireOrgId(context), profileId, {
          toolId,
        });
        sessionState.markToolAssigned(context.sessionId, toolId);
        return result;
      },
    },
    {
      name: "list_tools",
      description: "List all registered tools.",
      parameters: emptyObjectSchema(),
      async run() {
        return profileService.listTools();
      },
    },
    {
      name: "create_tool",
      description:
        'Register a JavaScript tool. Workflow: list_tools (check name) → write_file (~/.nakama/tools/<name>.js) → create_tool. Do not call list_profiles as part of this workflow.',
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Unique tool name." },
          description: { type: "string", description: "What the tool does." },
          handlerType: {
            type: "string",
            description: 'Handler type. Must be "javascript".',
          },
          handlerConfig: {
            type: "object",
            description:
              'For javascript tools: { "modulePath": "my-tool.js" } relative to ~/.nakama/tools/. The file must already exist and export run(input, context) plus optional parameters JSON schema.',
            additionalProperties: true,
          },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
      async run(input, context: ToolContext) {
        const name = readString(input, "name");
        const description = readString(input, "description");

        if (!name || !description) {
          throw new Error("name and description are required.");
        }

        const requestedHandlerType = readString(input, "handlerType");
        const handlerType = "javascript";
        const handlerConfig = readObject(input, "handlerConfig");

        if (requestedHandlerType && requestedHandlerType !== handlerType) {
          throw new Error(
            'Super Bot can only create JavaScript tools. Use handlerType "javascript".',
          );
        }

        const modulePath = readModulePath(handlerConfig);

        if (!modulePath?.endsWith(".js")) {
          throw new Error(
            'JavaScript tools require handlerConfig.modulePath ending in ".js". Write the module with write_file to ~/.nakama/tools/ first.',
          );
        }

        await validateJavascriptToolModule(modulePath);

        const tool = await profileService.createTool({
          name,
          description,
          handlerType,
          handlerConfig,
        });

        sessionState.markToolCreated(context.sessionId, tool.id);

        return { tool };
      },
    },
  ];
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(input: unknown, key: string): string | null | undefined {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[key];

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function readBoolean(input: unknown, key: string): boolean | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function readObject(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined;
  }

  return (input as Record<string, unknown>)[key];
}

function readSoulFiles(input: unknown): CreateProfileRequest["soulFiles"] | undefined {
  const raw = readObject(input, "soulFiles");

  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("soulFiles must be an object.");
  }

  const allowed = new Set<string>(SUPPORTED_SOUL_FILE_NAMES);
  const result: NonNullable<CreateProfileRequest["soulFiles"]> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`Unsupported soul file: ${key}`);
    }

    if (typeof value !== "string") {
      throw new Error(`Soul file content must be a string: ${key}`);
    }

    result[key as SupportedSoulFileName] = value;
  }

  return result;
}

function readModulePath(handlerConfig: unknown): string | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const modulePath = (handlerConfig as Record<string, unknown>).modulePath;
  return typeof modulePath === "string" && modulePath.trim() ? modulePath.trim() : null;
}
