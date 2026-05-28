import { TINYCLAW_API_VERSION } from "@tinyclaw/core";

export const openApiSchemas = {
  AgentChannel: {
    type: "string",
    enum: ["web", "cli", "telegram", "automation", "task"],
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
  ImageAttachment: {
    type: "object",
    required: ["mediaType", "data"],
    properties: {
      mediaType: { type: "string" },
      data: { type: "string", description: "Base64-encoded image bytes" },
    },
  },
  MessageContentPartText: {
    type: "object",
    required: ["type", "text"],
    properties: {
      type: { type: "string", const: "text" },
      text: { type: "string" },
    },
  },
  MessageContentPartImage: {
    type: "object",
    required: ["type", "mediaType", "data"],
    properties: {
      type: { type: "string", const: "image" },
      mediaType: { type: "string" },
      data: { type: "string" },
    },
  },
  SendMessageRequest: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
      images: {
        type: "array",
        items: { $ref: "#/components/schemas/ImageAttachment" },
      },
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
  CompactSessionRequest: {
    type: "object",
    properties: {
      force: { type: "boolean" },
    },
  },
  CompactionResponse: {
    type: "object",
    required: ["action", "messagesBefore", "messagesAfter"],
    properties: {
      action: {
        type: "string",
        enum: ["none", "pruned", "summarized"],
      },
      prunedTokens: { type: "integer" },
      messagesBefore: { type: "integer" },
      messagesAfter: { type: "integer" },
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
  ConfigureProviderRequest: {
    type: "object",
    required: ["apiKey"],
    properties: {
      apiKey: { type: "string" },
      model: { type: "string" },
    },
  },
  ConfigureProviderResponse: {
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
      "hasAvatar",
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
      hasAvatar: { type: "boolean" },
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
  UserContextStatusResponse: {
    type: "object",
    required: ["path", "active"],
    properties: {
      path: { type: "string" },
      active: { type: "boolean" },
      content: { type: "string" },
    },
  },
  UpdateUserContextRequest: {
    type: "object",
    required: ["content"],
    properties: {
      content: { type: "string" },
    },
  },
  InitUserContextResponse: {
    type: "object",
    required: ["path", "created"],
    properties: {
      path: { type: "string" },
      created: { type: "boolean" },
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
  AutomationWorkerStatus: {
    type: "object",
    required: ["ok", "running", "scheduledJobs", "activeRuns", "providerConfigured"],
    properties: {
      ok: { type: "boolean" },
      running: { type: "boolean" },
      scheduledJobs: { type: "integer" },
      activeRuns: { type: "integer" },
      providerConfigured: { type: "boolean" },
    },
  },
  TaskWorkerStatus: {
    type: "object",
    required: ["ok", "activeRuns", "providerConfigured"],
    properties: {
      ok: { type: "boolean" },
      activeRuns: { type: "integer" },
      providerConfigured: { type: "boolean" },
    },
  },
  SystemStatusResponse: {
    type: "object",
    required: ["server", "automationWorker", "taskWorker", "checkedAt"],
    properties: {
      server: { $ref: "#/components/schemas/HealthResponse" },
      automationWorker: { $ref: "#/components/schemas/AutomationWorkerStatus" },
      taskWorker: { $ref: "#/components/schemas/TaskWorkerStatus" },
      checkedAt: { type: "string" },
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
  StoredAutomation: {
    allOf: [
      { $ref: "#/components/schemas/AutomationDefinition" },
      {
        type: "object",
        required: ["profileId", "enabled", "createdAt", "updatedAt"],
        properties: {
          profileId: { type: "string" },
          enabled: { type: "boolean" },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
          nextRunAt: { type: ["string", "null"] },
          lastRunAt: { type: ["string", "null"] },
        },
      },
    ],
  },
  ListAutomationsResponse: {
    type: "object",
    required: ["automations"],
    properties: {
      automations: {
        type: "array",
        items: { $ref: "#/components/schemas/StoredAutomation" },
      },
    },
  },
  AutomationResponse: {
    type: "object",
    required: ["automation"],
    properties: {
      automation: { $ref: "#/components/schemas/StoredAutomation" },
    },
  },
  CreateAutomationRequest: {
    type: "object",
    required: ["name", "description", "prompt", "trigger"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      trigger: {
        oneOf: [
          { $ref: "#/components/schemas/AutomationTriggerManual" },
          { $ref: "#/components/schemas/AutomationTriggerSchedule" },
        ],
      },
      profileId: { type: "string" },
      enabled: { type: "boolean" },
    },
  },
  UpdateAutomationRequest: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      trigger: {
        oneOf: [
          { $ref: "#/components/schemas/AutomationTriggerManual" },
          { $ref: "#/components/schemas/AutomationTriggerSchedule" },
        ],
      },
      enabled: { type: "boolean" },
    },
  },
  AutomationRunRecord: {
    type: "object",
    required: ["id", "automationId", "status", "startedAt", "completedAt", "output", "error"],
    properties: {
      id: { type: "string" },
      automationId: { type: "string" },
      status: { type: "string", enum: ["running", "completed", "failed"] },
      startedAt: { type: "string" },
      completedAt: { type: ["string", "null"] },
      output: { type: ["string", "null"] },
      error: { type: ["string", "null"] },
    },
  },
  RunAutomationResponse: {
    type: "object",
    required: ["run"],
    properties: {
      run: { $ref: "#/components/schemas/AutomationRunRecord" },
    },
  },
  ListAutomationRunsResponse: {
    type: "object",
    required: ["runs"],
    properties: {
      runs: {
        type: "array",
        items: { $ref: "#/components/schemas/AutomationRunRecord" },
      },
    },
  },
  TaskStatus: {
    type: "string",
    enum: ["backlog", "todo", "in_progress", "done", "failed"],
  },
  StoredTask: {
    type: "object",
    required: [
      "id",
      "title",
      "description",
      "prompt",
      "profileId",
      "status",
      "position",
      "sessionId",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      profileId: { type: "string" },
      status: { $ref: "#/components/schemas/TaskStatus" },
      position: { type: "integer" },
      sessionId: { type: "string", nullable: true },
      createdAt: { type: "string" },
      updatedAt: { type: "string" },
    },
  },
  TaskMessagesResponse: {
    type: "object",
    required: ["sessionId", "messages"],
    properties: {
      sessionId: { type: "string" },
      messages: {
        type: "array",
        items: { $ref: "#/components/schemas/ChatMessage" },
      },
    },
  },
  ListTasksResponse: {
    type: "object",
    required: ["tasks"],
    properties: {
      tasks: {
        type: "array",
        items: { $ref: "#/components/schemas/StoredTask" },
      },
    },
  },
  TaskResponse: {
    type: "object",
    required: ["task"],
    properties: {
      task: { $ref: "#/components/schemas/StoredTask" },
    },
  },
  CreateTaskRequest: {
    type: "object",
    required: ["title", "prompt"],
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      profileId: { type: "string" },
      status: { $ref: "#/components/schemas/TaskStatus" },
    },
  },
  UpdateTaskRequest: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      profileId: { type: "string" },
      status: { $ref: "#/components/schemas/TaskStatus" },
      position: { type: "integer" },
    },
  },
  TaskRunRecord: {
    type: "object",
    required: ["id", "taskId", "status", "startedAt", "completedAt", "output", "error"],
    properties: {
      id: { type: "string" },
      taskId: { type: "string" },
      status: { type: "string", enum: ["running", "completed", "failed"] },
      startedAt: { type: "string" },
      completedAt: { type: "string", nullable: true },
      output: { type: "string", nullable: true },
      error: { type: "string", nullable: true },
    },
  },
  RunTaskResponse: {
    type: "object",
    required: ["run"],
    properties: {
      run: { $ref: "#/components/schemas/TaskRunRecord" },
    },
  },
  ListTaskRunsResponse: {
    type: "object",
    required: ["runs"],
    properties: {
      runs: {
        type: "array",
        items: { $ref: "#/components/schemas/TaskRunRecord" },
      },
    },
  },
  TimezoneSettingsResponse: {
    type: "object",
    required: ["timezone"],
    properties: {
      timezone: { type: "string" },
    },
  },
  UpdateTimezoneRequest: {
    type: "object",
    required: ["timezone"],
    properties: {
      timezone: { type: "string" },
    },
  },
  TelegramSettingsResponse: {
    type: "object",
    required: [
      "configured",
      "botTokenMasked",
      "handshakeCode",
      "pairedUserIds",
      "allowedUserIds",
      "profileId",
    ],
    properties: {
      configured: { type: "boolean" },
      botTokenMasked: { type: "string", nullable: true },
      handshakeCode: { type: "string", nullable: true },
      pairedUserIds: {
        type: "array",
        items: { type: "integer" },
      },
      allowedUserIds: {
        type: "array",
        items: { type: "integer" },
      },
      profileId: { type: "string" },
    },
  },
  UpdateTelegramSettingsRequest: {
    type: "object",
    properties: {
      botToken: { type: "string" },
      allowedUserIds: { type: "string" },
      profileId: { type: "string" },
    },
  },
  TimezoneCatalogEntry: {
    type: "object",
    required: [
      "id",
      "countryCode",
      "countryName",
      "city",
      "label",
      "offset",
      "abbreviation",
      "tzName",
    ],
    properties: {
      id: { type: "string" },
      countryCode: { type: "string" },
      countryName: { type: "string" },
      city: { type: "string" },
      label: { type: "string" },
      offset: { type: "string" },
      abbreviation: { type: "string" },
      tzName: { type: "string" },
      aliases: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  TimezoneCatalogGroup: {
    type: "object",
    required: ["countryCode", "countryName", "timezones"],
    properties: {
      countryCode: { type: "string" },
      countryName: { type: "string" },
      timezones: {
        type: "array",
        items: { $ref: "#/components/schemas/TimezoneCatalogEntry" },
      },
    },
  },
  ListTimezonesResponse: {
    type: "object",
    required: ["groups"],
    properties: {
      groups: {
        type: "array",
        items: { $ref: "#/components/schemas/TimezoneCatalogGroup" },
      },
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
  AutomationId: {
    name: "automationId",
    in: "path",
    required: true,
    schema: { type: "string" },
  },
  TaskId: {
    name: "taskId",
    in: "path",
    required: true,
    schema: { type: "string" },
  },
} as const;
