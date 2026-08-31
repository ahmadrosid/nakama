import {
  type CreateProfileRequest,
  emptyObjectSchema,
  getProfileSoulDir,
  loadSoulStack,
  type ToolContext,
  type ToolDefinition,
  type UpdateProfileRequest,
} from "@nakama/core";
import {
  CUSTOM_TOOL_HANDLERS,
  customToolTypesLabel,
  isCustomToolType,
} from "../services/custom-tool-handlers";
import type { ProfileService } from "../services/profile-service";
import {
  PROFILE_CREATE_CONFIRMATION_MESSAGE,
  PROFILE_UPDATE_CONFIRMATION_MESSAGE,
  type SuperBotSessionState,
  TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE,
} from "../services/super-bot-session-state";

const SUPPORTED_SOUL_FILE_NAMES = [
  "SOUL.md",
  "STYLE.md",
  "INSTRUCTIONS.md",
  "MEMORY.md",
] as const;
type SupportedSoulFileName = (typeof SUPPORTED_SOUL_FILE_NAMES)[number];

const SOUL_STACK_KEY_TO_FILE_NAME = {
  instructions: "INSTRUCTIONS.md",
  memory: "MEMORY.md",
  soul: "SOUL.md",
  style: "STYLE.md",
} as const;

const soulFilesParameterSchema = {
  additionalProperties: false,
  description:
    "Soul file contents. Supported keys: SOUL.md, STYLE.md, INSTRUCTIONS.md, MEMORY.md. Only provided keys are written.",
  properties: {
    "INSTRUCTIONS.md": { type: "string" },
    "MEMORY.md": { type: "string" },
    "SOUL.md": { type: "string" },
    "STYLE.md": { type: "string" },
  },
  type: "object",
} as const;

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();

  if (!orgId) {
    throw new Error("Organization context is required.");
  }

  return orgId;
}

export function createSuperBotTools(
  profileService: ProfileService,
  sessionState: SuperBotSessionState
): ToolDefinition[] {
  return [
    {
      description:
        "List all bot profiles with their id, name, and tool counts. Use when managing profiles or when the user asks you to assign a tool and you need profile ids.",
      name: "list_profiles",
      parameters: emptyObjectSchema(),
      async run(_input, context: ToolContext) {
        return profileService.listProfiles(requireOrgId(context));
      },
    },
    {
      description:
        "Get a bot profile by id, including assigned tools and current soul file contents.",
      name: "get_profile",
      parameters: {
        additionalProperties: false,
        properties: {
          profileId: { description: "Profile id to fetch.", type: "string" },
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

        const response = await profileService.getProfile(orgId, profileId);
        const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
        const soulFiles: Partial<Record<SupportedSoulFileName, string>> = {};

        for (const [key, fileName] of Object.entries(
          SOUL_STACK_KEY_TO_FILE_NAME
        )) {
          const content = stack.files[key as keyof typeof stack.files];
          if (typeof content === "string") {
            soulFiles[fileName as SupportedSoulFileName] = content;
          }
        }

        return { ...response, soulFiles };
      },
    },
    {
      description: "Create a new bot profile.",
      name: "create_profile",
      parameters: {
        additionalProperties: false,
        properties: {
          isSuper: {
            description: "Whether this profile is a super bot.",
            type: "boolean",
          },
          model: {
            description: "Model override, or null to use the server default.",
            type: "string",
          },
          name: {
            description: "Display name for the profile.",
            type: "string",
          },
          soulFiles: {
            ...soulFilesParameterSchema,
            description:
              "Optional generated soul file contents for the new profile. Supported keys: SOUL.md, STYLE.md, INSTRUCTIONS.md, MEMORY.md.",
          },
          systemPrompt: {
            description: "System prompt for the bot.",
            type: "string",
          },
        },
        required: ["name"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const name = readString(input, "name");

        if (!name) {
          throw new Error("name is required.");
        }

        if (!sessionState.canCreateProfile(context.sessionId)) {
          throw new Error(PROFILE_CREATE_CONFIRMATION_MESSAGE);
        }

        return profileService.createProfile(requireOrgId(context), {
          isSuper: readBoolean(input, "isSuper") ?? false,
          model: readOptionalString(input, "model"),
          name,
          soulFiles: readSoulFiles(input),
          systemPrompt: readString(input, "systemPrompt") ?? undefined,
        });
      },
    },
    {
      description:
        "Update a profile's stored system prompt and/or soul files. Draft changes in chat, wait for explicit user confirmation, then call this. Use get_profile first when you need the current prompt or soul files.",
      name: "update_profile",
      parameters: {
        additionalProperties: false,
        properties: {
          profileId: {
            description: "Profile id to update.",
            type: "string",
          },
          soulFiles: soulFilesParameterSchema,
          systemPrompt: {
            description:
              "Replacement system prompt stored on the profile. Pass an empty string to clear it. Omit to leave unchanged.",
            type: "string",
          },
        },
        required: ["profileId"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const profileId = readString(input, "profileId");
        const systemPrompt = readStringAllowEmpty(input, "systemPrompt");
        const soulFiles = readSoulFiles(input);

        if (!profileId) {
          throw new Error("profileId is required.");
        }

        if (systemPrompt === null && soulFiles === undefined) {
          throw new Error("Provide systemPrompt and/or soulFiles.");
        }

        if (!sessionState.canCreateProfile(context.sessionId)) {
          throw new Error(PROFILE_UPDATE_CONFIRMATION_MESSAGE);
        }

        const request: UpdateProfileRequest = {};
        if (systemPrompt !== null) {
          request.systemPrompt = systemPrompt;
        }
        if (soulFiles !== undefined) {
          request.soulFiles = soulFiles;
        }

        return profileService.updateProfile(
          requireOrgId(context),
          profileId,
          request,
          {
            actorUserId: context.userId ?? null,
            source: "super_bot",
          }
        );
      },
    },
    {
      description:
        "Assign an existing tool to a profile. Use only when the user explicitly asks to assign a tool to a profile.",
      name: "assign_tool_to_profile",
      parameters: {
        additionalProperties: false,
        properties: {
          profileId: { description: "Target profile id.", type: "string" },
          toolId: { description: "Tool id to assign.", type: "string" },
        },
        required: ["profileId", "toolId"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const profileId = readString(input, "profileId");
        const toolId = readString(input, "toolId");

        if (!(profileId && toolId)) {
          throw new Error("profileId and toolId are required.");
        }

        if (!sessionState.canAssignTool(context.sessionId, toolId)) {
          throw new Error(TOOL_ASSIGNMENT_CONFIRMATION_MESSAGE);
        }

        const result = await profileService.assignTool(
          requireOrgId(context),
          profileId,
          {
            toolId,
          },
          {
            actorUserId: context.userId ?? null,
            source: "super_bot",
          }
        );
        sessionState.markToolAssigned(context.sessionId, toolId);
        return result;
      },
    },
    {
      description: "List all registered tools.",
      name: "list_tools",
      parameters: emptyObjectSchema(),
      async run() {
        return profileService.listTools();
      },
    },
    {
      description:
        "Register a custom tool (javascript or python). Workflow: list_tools (check name) → write_file (~/.nakama/tools/<name>.js|.py) → create_tool. Do not call list_profiles as part of this workflow.",
      name: "create_tool",
      parameters: {
        additionalProperties: false,
        properties: {
          description: { description: "What the tool does.", type: "string" },
          handlerConfig: {
            additionalProperties: true,
            description:
              'Handler config: { "modulePath": "my-tool.js" } or { "modulePath": "my-tool.py" } relative to ~/.nakama/tools/. The file must already exist. JS modules export run(input, context) plus optional parameters. Python modules define def run(input, context) and a __main__ stdin/stdout JSON harness.',
            type: "object",
          },
          handlerType: {
            description: 'Handler type: "javascript" (default) or "python".',
            type: "string",
          },
          name: { description: "Unique tool name.", type: "string" },
        },
        required: ["name", "description"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const name = readString(input, "name");
        const description = readString(input, "description");

        if (!(name && description)) {
          throw new Error("name and description are required.");
        }

        const requestedHandlerType = readString(input, "handlerType");
        const handlerType = requestedHandlerType ?? "javascript";

        if (!isCustomToolType(handlerType)) {
          throw new Error(
            `Super Bot can only create ${customToolTypesLabel()} tools. Use handlerType ${customToolTypesLabel()}.`
          );
        }

        const handler = CUSTOM_TOOL_HANDLERS[handlerType];
        const handlerConfig = readObject(input, "handlerConfig");
        const modulePath = readModulePath(handlerConfig);

        if (!modulePath?.endsWith(handler.extension)) {
          throw new Error(
            `${handlerType} tools require handlerConfig.modulePath ending in "${handler.extension}". Write the module with write_file to ~/.nakama/tools/ first.`
          );
        }

        await handler.validateModule(modulePath);

        const tool = await profileService.createTool({
          description,
          handlerConfig,
          handlerType,
          name,
        });

        sessionState.markToolCreated(context.sessionId, tool.id);

        return { tool };
      },
    },
  ];
}

function readString(input: unknown, key: string): string | null {
  const value = readStringAllowEmpty(input, key);
  return value?.trim() ? value.trim() : null;
}

function readStringAllowEmpty(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readOptionalString(
  input: unknown,
  key: string
): string | null | undefined {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return;
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
    return;
  }

  return (input as Record<string, unknown>)[key];
}

function readSoulFiles(
  input: unknown
):
  | CreateProfileRequest["soulFiles"]
  | UpdateProfileRequest["soulFiles"]
  | undefined {
  const raw = readObject(input, "soulFiles");

  if (raw === undefined) {
    return;
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
  return typeof modulePath === "string" && modulePath.trim()
    ? modulePath.trim()
    : null;
}
