import {
  type CreateProfileRequest,
  emptyObjectSchema,
  getCustomToolsDir,
  getProfileSoulDir,
  loadSoulStack,
  type ToolContext,
  type ToolDefinition,
  type UpdateProfileRequest,
} from "@nakama/core";
import { z } from "zod";
import {
  CUSTOM_TOOL_HANDLERS,
  customToolTypesLabel,
  isCustomToolType,
} from "../services/custom-tool-handlers";
import {
  completeToolSetup,
  loadToolSetup,
  saveToolSetup,
} from "../services/custom-tool-shared";
import type { ProfileService } from "../services/profile-service";
import {
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
  sessionState: SuperBotSessionState,
  resolveInheritedModel?: (
    model: string | null,
    context: ToolContext
  ) => Promise<string | null>
): ToolDefinition[] {
  return [
    {
      description:
        "Present a custom tool build plan for one-click approval, optional API key, and agent assignment. Call before writing code, then end the turn. Never accept API keys in tool inputs or chat. After approval, build and register with create_tool using the returned setupId. Works for any JavaScript or Python tool.",
      name: "propose_tool",
      parameters: {
        additionalProperties: false,
        properties: {
          description: { description: "What the tool does.", type: "string" },
          name: { description: "Unique tool name.", type: "string" },
          plan: {
            description:
              "User-facing plan: inputs, outputs, external effects, and provider if applicable.",
            type: "string",
          },
          profileId: {
            description:
              "Optional suggested existing agent. The user can change it in the card.",
            type: "string",
          },
          requiresApiKey: { type: "boolean" },
        },
        required: ["name", "description", "plan", "requiresApiKey"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        if (!context.sessionId) {
          throw new Error("A chat session is required to propose a tool.");
        }
        const parsed = z
          .object({
            description: z.string().trim().min(1).max(2000),
            name: z.string().trim().min(1).max(128),
            plan: z.string().trim().min(1).max(8000),
            profileId: z.string().trim().min(1).optional(),
            requiresApiKey: z.boolean(),
          })
          .strict()
          .parse(input);
        if (parsed.profileId) {
          await profileService.getProfile(orgId, parsed.profileId);
        }
        const plan = {
          ...parsed,
          id: crypto.randomUUID(),
          sessionId: context.sessionId,
          status: "pending" as const,
        };
        await saveToolSetup(orgId, plan);
        return { orgId, setupId: plan.id, type: "tool_setup_required" };
      },
    },
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
            type: ["string", "null"],
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

        const orgId = requireOrgId(context);
        let model = readOptionalString(input, "model");
        if (model === undefined && context.profileId) {
          const source = await profileService.getProfile(
            orgId,
            context.profileId
          );
          model = resolveInheritedModel
            ? await resolveInheritedModel(source.profile.model, context)
            : source.profile.model;
        }

        const result = await profileService.createProfile(orgId, {
          isSuper: readBoolean(input, "isSuper") ?? false,
          model,
          name,
          soulFiles: readSoulFiles(input),
          systemPrompt: readString(input, "systemPrompt") ?? undefined,
        });

        return {
          ...result,
          type: "profile_created" as const,
        };
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

        if (!sessionState.canUpdateProfile(context.sessionId)) {
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
      async run(_input, context) {
        const orgId = context.orgId?.trim();
        if (!orgId) {
          return { tools: [] };
        }
        return profileService.listTools(orgId);
      },
    },
    {
      description:
        "Register an existing JavaScript or Python module. For a setup card, pass setupId after approval; registration connects its saved key and assigns the selected agent automatically. Registration does not execute or test the tool.",
      name: "create_tool",
      parameters: {
        additionalProperties: false,
        properties: {
          description: { description: "What the tool does.", type: "string" },
          handlerConfig: {
            additionalProperties: true,
            description: `Write the module with write_file using an absolute path under ${getCustomToolsDir()} before registering; omit cwd. modulePath: filename relative to that directory, ending in .js or .py. JavaScript (preferred): export async function run(input, context). Python: def run(input, context) plus a __main__ harness reading JSON from sys.stdin and writing JSON to sys.stdout. parameters: input JSON schema with properties and required fields; exported JS parameters are ignored. Validate inputs; return JSON-serializable results; log only to stderr. Profile files: context.workspaceRoot (JS) or NAKAMA_WORKSPACE_ROOT (Python). requiresApiKey: true only if needed; read NAKAMA_TOOL_API_KEY at runtime, never put keys in inputs/source/output. Direct users to the web chat Configure card, then retry.`,
            type: "object",
          },
          handlerType: {
            description: 'Handler type: "javascript" (default) or "python".',
            type: "string",
          },
          name: { description: "Unique tool name.", type: "string" },
          setupId: {
            description:
              "Approved setup id from propose_tool. Never put an API key here.",
            type: "string",
          },
        },
        required: ["name", "description"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const setupId = readString(input, "setupId");
        const setup = setupId
          ? await loadToolSetup(requireOrgId(context), setupId)
          : null;
        if (
          setup &&
          (setup.sessionId !== context.sessionId || setup.status === "pending")
        ) {
          throw new Error(
            "Approve this tool's setup card in the original chat before building it."
          );
        }
        if (setup?.status === "ready") {
          return {
            profileId: setup.profileId,
            toolId: setup.toolId,
            type: "tool_setup_ready",
          };
        }
        const name = setup?.name ?? readString(input, "name");
        const description =
          setup?.description ?? readString(input, "description");

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
        const rawHandlerConfig = readObject(input, "handlerConfig");
        const handlerConfig =
          rawHandlerConfig &&
          typeof rawHandlerConfig === "object" &&
          !Array.isArray(rawHandlerConfig)
            ? ({ ...rawHandlerConfig } as Record<string, unknown>)
            : {};
        if (setup) {
          handlerConfig.requiresApiKey = setup.requiresApiKey;
        }
        const modulePath = readModulePath(handlerConfig);

        if (!modulePath?.endsWith(handler.extension)) {
          throw new Error(
            `${handlerType} tools require handlerConfig.modulePath ending in "${handler.extension}". Write the module with write_file to ${getCustomToolsDir()} first.`
          );
        }

        await handler.validateModule(modulePath);

        const tool = setup?.toolId
          ? (await profileService.getTool(setup.toolId)).tool
          : await profileService.createTool({
              description,
              handlerConfig,
              handlerType,
              name,
            });

        sessionState.markToolCreated(context.sessionId, tool.id);

        if (setup) {
          const orgId = requireOrgId(context);
          await saveToolSetup(orgId, { ...setup, toolId: tool.id });
          if (setup.profileId) {
            await profileService.assignTool(
              orgId,
              setup.profileId,
              { toolId: tool.id },
              {
                actorUserId: context.userId ?? null,
                source: "super_bot",
              }
            );
          }
          await completeToolSetup(orgId, setup, tool.id);
          return {
            profileId: setup.profileId,
            tool,
            toolId: tool.id,
            type: "tool_setup_ready",
          };
        }

        if (
          (tool.handlerConfig as Record<string, unknown>)?.requiresApiKey ===
          true
        ) {
          return {
            orgId: requireOrgId(context),
            tool,
            toolId: tool.id,
            toolName: tool.name,
            type: "tool_credentials_required",
          };
        }
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
