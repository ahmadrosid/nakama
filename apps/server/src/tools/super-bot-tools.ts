import type { ProfileService } from "./profile-service";
import { emptyObjectSchema, type ToolDefinition } from "@tinyclaw/core";
import { validateJavascriptToolModule } from "../services/javascript-tool-loader";

export function createSuperBotTools(profileService: ProfileService): ToolDefinition[] {
  return [
    {
      name: "list_profiles",
      description: "List all bot profiles with their id, name, and tool counts.",
      parameters: emptyObjectSchema(),
      async run() {
        return profileService.listProfiles();
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
      async run(input) {
        const profileId = readString(input, "profileId");

        if (!profileId) {
          throw new Error("profileId is required.");
        }

        return profileService.getProfile(profileId);
      },
    },
    {
      name: "create_profile",
      description: "Create a new bot profile.",
      parameters: {
        type: "object",
        properties: {
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
        },
        required: ["name"],
        additionalProperties: false,
      },
      async run(input) {
        const name = readString(input, "name");

        if (!name) {
          throw new Error("name is required.");
        }

        return profileService.createProfile({
          name,
          systemPrompt: readString(input, "systemPrompt") ?? undefined,
          model: readOptionalString(input, "model"),
          isSuper: readBoolean(input, "isSuper") ?? false,
        });
      },
    },
    {
      name: "assign_tool_to_profile",
      description: "Assign an existing tool to a profile.",
      parameters: {
        type: "object",
        properties: {
          profileId: { type: "string", description: "Target profile id." },
          toolId: { type: "string", description: "Tool id to assign." },
        },
        required: ["profileId", "toolId"],
        additionalProperties: false,
      },
      async run(input) {
        const profileId = readString(input, "profileId");
        const toolId = readString(input, "toolId");

        if (!profileId || !toolId) {
          throw new Error("profileId and toolId are required.");
        }

        return profileService.assignTool(profileId, { toolId });
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
        'Register a JavaScript tool. First write ~/.tinyclaw/tools/<name>.js with write_file, then call this with handlerType "javascript".',
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
              'For javascript tools: { "modulePath": "my-tool.js" } relative to ~/.tinyclaw/tools/. The file must already exist and export run(input, context) plus optional parameters JSON schema.',
            additionalProperties: true,
          },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
      async run(input) {
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
            'JavaScript tools require handlerConfig.modulePath ending in ".js". Write the module with write_file to ~/.tinyclaw/tools/ first.',
          );
        }

        await validateJavascriptToolModule(modulePath);

        const tool = await profileService.createTool({
          name,
          description,
          handlerType,
          handlerConfig,
        });

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

function readModulePath(handlerConfig: unknown): string | null {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    return null;
  }

  const modulePath = (handlerConfig as Record<string, unknown>).modulePath;
  return typeof modulePath === "string" && modulePath.trim() ? modulePath.trim() : null;
}
