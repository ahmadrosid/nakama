import { TINYCLAW_API_VERSION } from "@tinyclaw/core";

export const openApiSchemas = {
  AgentChannel: {
    type: "string",
    enum: ["web", "cli", "telegram"],
  },
  ApiErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
    },
  },
  HealthResponse: {
    type: "object",
    required: ["ok", "apiVersion", "providerConfigured"],
    properties: {
      ok: { type: "boolean", const: true },
      apiVersion: { type: "integer", const: TINYCLAW_API_VERSION },
      providerConfigured: { type: "boolean" },
    },
  },
  CreateSessionRequest: {
    type: "object",
    required: ["channel"],
    properties: {
      channel: { $ref: "#/components/schemas/AgentChannel" },
      profileId: {
        type: "string",
        description: "Bot profile ID. Defaults to profile_default.",
      },
    },
  },
  CreateSessionResponse: {
    type: "object",
    required: ["sessionId"],
    properties: {
      sessionId: { type: "string" },
    },
  },
  SessionSummary: {
    type: "object",
    required: [
      "id",
      "profileId",
      "channel",
      "createdAt",
      "updatedAt",
      "messageCount",
      "preview",
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string" },
      channel: { $ref: "#/components/schemas/AgentChannel" },
      createdAt: { type: "string" },
      updatedAt: { type: "string" },
      messageCount: { type: "integer" },
      preview: { type: "string", nullable: true },
    },
  },
  ListSessionsResponse: {
    type: "object",
    required: ["sessions"],
    properties: {
      sessions: {
        type: "array",
        items: { $ref: "#/components/schemas/SessionSummary" },
      },
    },
  },
  SessionMessagesResponse: {
    type: "object",
    required: ["messages"],
    properties: {
      messages: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
  },
  SendMessageRequest: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
      stream: { type: "boolean" },
    },
  },
  SendMessageResponse: {
    type: "object",
    required: ["reply"],
    properties: {
      reply: { type: "string" },
    },
  },
  StreamEvent: {
    oneOf: [
      {
        type: "object",
        required: ["type", "delta"],
        properties: {
          type: { type: "string", const: "chunk" },
          delta: { type: "string" },
        },
      },
      {
        type: "object",
        required: ["type", "toolCallId", "tool", "input"],
        properties: {
          type: { type: "string", const: "tool_start" },
          toolCallId: { type: "string" },
          tool: { type: "string" },
          input: { type: "object", additionalProperties: true },
        },
      },
      {
        type: "object",
        required: ["type", "toolCallId", "tool", "result"],
        properties: {
          type: { type: "string", const: "tool_end" },
          toolCallId: { type: "string" },
          tool: { type: "string" },
          result: {},
        },
      },
      {
        type: "object",
        required: ["type", "reply"],
        properties: {
          type: { type: "string", const: "done" },
          reply: { type: "string" },
        },
      },
      {
        type: "object",
        required: ["type", "error"],
        properties: {
          type: { type: "string", const: "error" },
          error: { type: "string" },
        },
      },
    ],
  },
  ProviderModelOption: {
    type: "object",
    required: ["id", "name", "provider"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      provider: { type: "string", enum: ["openai", "anthropic"] },
      default: { type: "boolean" },
    },
  },
  ModelsResponse: {
    type: "object",
    required: ["provider", "currentModel", "defaultModel", "models"],
    properties: {
      provider: {
        type: ["string", "null"],
        enum: ["openai", "anthropic", null],
      },
      currentModel: { type: ["string", "null"] },
      defaultModel: { type: ["string", "null"] },
      models: {
        type: "array",
        items: { $ref: "#/components/schemas/ProviderModelOption" },
      },
    },
  },
  SetModelRequest: {
    type: "object",
    required: ["model"],
    properties: {
      model: { type: "string" },
    },
  },
  SetModelResponse: {
    type: "object",
    required: ["provider", "currentModel"],
    properties: {
      provider: { type: "string", enum: ["openai", "anthropic"] },
      currentModel: { type: "string" },
    },
  },
  ToolSummary: {
    type: "object",
    required: ["id", "name", "description", "handlerType"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      handlerType: {
        type: "string",
        enum: ["builtin", "bash", "javascript"],
      },
    },
  },
  ProfileSummary: {
    type: "object",
    required: [
      "id",
      "name",
      "model",
      "isSuper",
      "toolCount",
      "soulActive",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      model: { type: ["string", "null"] },
      isSuper: { type: "boolean" },
      toolCount: { type: "integer" },
      soulActive: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  ProfileDetail: {
    allOf: [
      { $ref: "#/components/schemas/ProfileSummary" },
      {
        type: "object",
        required: ["systemPrompt", "tools"],
        properties: {
          systemPrompt: { type: "string" },
          tools: {
            type: "array",
            items: { $ref: "#/components/schemas/ToolSummary" },
          },
        },
      },
    ],
  },
  ProfileResponse: {
    type: "object",
    required: ["profile"],
    properties: {
      profile: { $ref: "#/components/schemas/ProfileDetail" },
    },
  },
  ListProfilesResponse: {
    type: "object",
    required: ["profiles"],
    properties: {
      profiles: {
        type: "array",
        items: { $ref: "#/components/schemas/ProfileSummary" },
      },
    },
  },
  CreateProfileRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      systemPrompt: { type: "string" },
      model: { type: ["string", "null"] },
      isSuper: { type: "boolean" },
    },
  },
  UpdateProfileRequest: {
    type: "object",
    properties: {
      name: { type: "string" },
      systemPrompt: { type: "string" },
      model: { type: ["string", "null"] },
    },
  },
  ListToolsResponse: {
    type: "object",
    required: ["tools"],
    properties: {
      tools: {
        type: "array",
        items: { $ref: "#/components/schemas/ToolSummary" },
      },
    },
  },
  CreateToolRequest: {
    type: "object",
    required: ["name", "description"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      handlerType: {
        type: "string",
        enum: ["javascript"],
        description: 'Must be "javascript".',
      },
      handlerConfig: {
        type: "object",
        description:
          'JavaScript tool config, for example { "modulePath": "my-tool.js" } relative to ~/.tinyclaw/tools/.',
      },
    },
  },
  CreateToolResponse: {
    type: "object",
    required: ["tool"],
    properties: {
      tool: { $ref: "#/components/schemas/ToolSummary" },
    },
  },
  AssignToolRequest: {
    type: "object",
    required: ["toolId"],
    properties: {
      toolId: { type: "string" },
    },
  },
  SoulFileStatus: {
    type: "object",
    required: ["soul", "style", "skill", "memory", "examples"],
    properties: {
      soul: { type: "boolean" },
      style: { type: "boolean" },
      skill: { type: "boolean" },
      memory: { type: "boolean" },
      examples: { type: "boolean" },
    },
  },
  SoulStatusResponse: {
    type: "object",
    required: ["directory", "active", "files"],
    properties: {
      directory: { type: "string" },
      active: { type: "boolean" },
      files: { $ref: "#/components/schemas/SoulFileStatus" },
      contents: { $ref: "#/components/schemas/SoulStackFiles" },
      profileId: { type: "string" },
    },
  },
  InitSoulResponse: {
    type: "object",
    required: ["directory", "created"],
    properties: {
      directory: { type: "string" },
      created: {
        type: "array",
        items: { type: "string" },
      },
      profileId: { type: "string" },
    },
  },
  SoulStackFiles: {
    type: "object",
    properties: {
      soul: { type: "string" },
      style: { type: "string" },
      skill: { type: "string" },
      memory: { type: "string" },
      examples: { type: "string" },
    },
  },
  SoulStackResponse: {
    type: "object",
    required: ["directory", "files", "loaded"],
    properties: {
      directory: { type: "string" },
      files: { $ref: "#/components/schemas/SoulStackFiles" },
      loaded: {
        type: "array",
        items: { type: "string" },
      },
      profileId: { type: "string" },
    },
  },
  UpdateSoulFileRequest: {
    type: "object",
    required: ["content"],
    properties: {
      content: { type: "string" },
    },
  },
  AutomationTriggerManual: {
    type: "object",
    required: ["type"],
    properties: {
      type: { type: "string", const: "manual" },
    },
  },
  AutomationTriggerSchedule: {
    type: "object",
    required: ["type", "cron"],
    properties: {
      type: { type: "string", const: "schedule" },
      cron: { type: "string" },
      timezone: { type: "string" },
    },
  },
  AutomationStep: {
    type: "object",
    required: ["id", "tool", "input"],
    properties: {
      id: { type: "string" },
      tool: { type: "string" },
      input: { type: "object", additionalProperties: true },
    },
  },
  AutomationDefinition: {
    type: "object",
    required: ["id", "name", "description", "prompt", "trigger", "steps", "version"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      trigger: {
        oneOf: [
          { $ref: "#/components/schemas/AutomationTriggerManual" },
          { $ref: "#/components/schemas/AutomationTriggerSchedule" },
        ],
      },
      steps: {
        type: "array",
        items: { $ref: "#/components/schemas/AutomationStep" },
      },
      version: { type: "integer" },
    },
  },
  DraftAutomationRequest: {
    type: "object",
    required: ["prompt", "channel"],
    properties: {
      prompt: { type: "string" },
      channel: { $ref: "#/components/schemas/AgentChannel" },
    },
  },
  DraftAutomationResponse: {
    type: "object",
    required: ["automation"],
    properties: {
      automation: { $ref: "#/components/schemas/AutomationDefinition" },
    },
  },
} as const;

export const openApiParameters = {
  SessionId: {
    name: "sessionId",
    in: "path",
    required: true,
    schema: { type: "string" },
  },
  ProfileId: {
    name: "profileId",
    in: "path",
    required: true,
    schema: { type: "string" },
  },
  ToolId: {
    name: "toolId",
    in: "path",
    required: true,
    schema: { type: "string" },
  },
} as const;
