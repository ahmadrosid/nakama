import {
  type CreateProfileRequest,
  emptyObjectSchema,
  getCustomToolsDir,
  getProfileSoulDir,
  type JsonValue,
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

const SuperBotInputSchema = z.record(z.string(), z.json());

type SuperBotInput = z.infer<typeof SuperBotInputSchema>;

const SOUL_STACK_FILES = [
  { fileName: "INSTRUCTIONS.md", key: "instructions" },
  { fileName: "MEMORY.md", key: "memory" },
  { fileName: "SOUL.md", key: "soul" },
  { fileName: "STYLE.md", key: "style" },
] as const;

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
        const toolInput = SuperBotInputSchema.parse(input);
        const orgId = requireOrgId(context);
        const profileId = readString(toolInput, "profileId");

        if (!profileId) {
          throw new Error("profileId is required.");
        }

        const response = await profileService.getProfile(orgId, profileId);
        const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
        const soulFiles: Partial<Record<SupportedSoulFileName, string>> = {};

        for (const { fileName, key } of SOUL_STACK_FILES) {
          const content = stack.files[key];

          if (content) {
            soulFiles[fileName] = content;
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
        const toolInput = SuperBotInputSchema.parse(input);
        const name = readString(toolInput, "name");

        if (!name) {
          throw new Error("name is required.");
        }

        const orgId = requireOrgId(context);
        let model = readOptionalString(toolInput, "model");

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
          isSuper: readBoolean(toolInput, "isSuper") ?? false,
          model,
          name,
          soulFiles: readSoulFiles(toolInput),
          systemPrompt: readString(toolInput, "systemPrompt") ?? undefined,
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
        const toolInput = SuperBotInputSchema.parse(input);
        const profileId = readString(toolInput, "profileId");
        const systemPrompt = readStringAllowEmpty(toolInput, "systemPrompt");
        const soulFiles = readSoulFiles(toolInput);

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
        const toolInput = SuperBotInputSchema.parse(input);
        const profileId = readString(toolInput, "profileId");
        const toolId = readString(toolInput, "toolId");

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
            description: `Write the module with write_file using an absolute path under ${getCustomToolsDir()} before registering; omit cwd. modulePath: filename relative to that directory, ending in .js or .py. JavaScript (preferred): export async function run(input, context). Python: def run(input, context) plus a __main__ harness reading JSON from sys.stdin and writing JSON to sys.stdout. parameters: input JSON schema with properties and required fields; exported JS parameters are ignored. Validate inputs; return JSON-serializable results; log only to stderr. Profile files: context.workspaceRoot (JS) or NAKAMA_WORKSPACE_ROOT (Python). requiresApiKey: true only if needed; read NAKAMA_TOOL_API_KEY at runtime, never put keys in inputs/source/output. env: for other settings (base URL, account id, extra keys), list [{ name: "UPPER_SNAKE_CASE", secret: true|false }] and read process.env[name] (JS) or os.environ[name] (Python); names may not start with NAKAMA_, NODE_, PYTHON, LD_ or be PATH/HOME. An admin fills env values in the tool playground Configuration card. Direct users to the web chat Configure card, then retry.`,
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
        const toolInput = SuperBotInputSchema.parse(input);
        const setupId = readString(toolInput, "setupId");

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

        const name = setup?.name ?? readString(toolInput, "name");

        const description =
          setup?.description ?? readString(toolInput, "description");

        if (!(name && description)) {
          throw new Error("name and description are required.");
        }

        const requestedHandlerType = readString(toolInput, "handlerType");
        const handlerType = requestedHandlerType ?? "javascript";

        if (!isCustomToolType(handlerType)) {
          throw new Error(
            `Super Bot can only create ${customToolTypesLabel()} tools. Use handlerType ${customToolTypesLabel()}.`
          );
        }

        const handler = CUSTOM_TOOL_HANDLERS[handlerType];
        const rawHandlerConfig = readObject(toolInput, "handlerConfig");

        const parsedHandlerConfig = z
          .record(z.string(), z.json())
          .safeParse(rawHandlerConfig);

        const handlerConfig = parsedHandlerConfig.success
          ? { ...parsedHandlerConfig.data }
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

        const storedHandlerConfig = z
          .record(z.string(), z.json())
          .safeParse(tool.handlerConfig);

        if (
          z
            .boolean()
            .safeParse(
              storedHandlerConfig.success
                ? storedHandlerConfig.data.requiresApiKey
                : undefined
            ).data === true
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

function readString(input: SuperBotInput, key: string): string | null {
  const value = readStringAllowEmpty(input, key);

  return value?.trim() ? value.trim() : null;
}

function readStringAllowEmpty(
  input: SuperBotInput,
  key: string
): string | null {
  return z.string().safeParse(input[key]).data ?? null;
}

function readOptionalString(
  input: SuperBotInput,
  key: string
): string | null | undefined {
  const value = input[key];

  if (value === null) {
    return null;
  }

  return z.string().safeParse(value).data;
}

function readBoolean(input: SuperBotInput, key: string): boolean | null {
  return z.boolean().safeParse(input[key]).data ?? null;
}

function readObject(input: SuperBotInput, key: string): JsonValue | undefined {
  return input[key];
}

function readSoulFiles(
  input: SuperBotInput
):
  | CreateProfileRequest["soulFiles"]
  | UpdateProfileRequest["soulFiles"]
  | undefined {
  const raw = readObject(input, "soulFiles");

  if (raw === undefined) {
    return;
  }

  const allowed = new Set<string>(SUPPORTED_SOUL_FILE_NAMES);
  const result: NonNullable<CreateProfileRequest["soulFiles"]> = {};
  const files = z.record(z.string(), z.string()).safeParse(raw);

  if (!files.success) {
    throw new Error("soulFiles must be an object with string values.");
  }

  for (const [key, value] of Object.entries(files.data)) {
    const supportedName = SUPPORTED_SOUL_FILE_NAMES.find(
      (name) => name === key
    );

    if (!(supportedName && allowed.has(key))) {
      throw new Error(`Unsupported soul file: ${key}`);
    }

    result[supportedName] = value;
  }

  return result;
}

function readModulePath(
  handlerConfig: Record<string, JsonValue>
): string | null {
  return readString(handlerConfig, "modulePath");
}
