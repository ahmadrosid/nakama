import { TINYCLAW_API_VERSION } from "@tinyclaw/core";

export const openApiSchemas = {
  AgentChannel: {
    type: "string",
    enum: ["web", "cli", "telegram", "whatsapp", "automation", "task"],
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
  BranchSessionRequest: {
    type: "object",
    required: ["messageIndex"],
    properties: {
      messageIndex: { type: "integer", minimum: 0 },
    },
  },
  BranchSessionResponse: {
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
      "title",
      "preview",
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string" },
      channel: { $ref: "#/components/schemas/AgentChannel" },
      createdAt: { type: "string" },
      updatedAt: { type: "string" },
      messageCount: { type: "integer" },
      title: { type: "string", nullable: true },
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
  AgentTodo: {
    type: "object",
    required: ["id", "content", "status"],
    properties: {
      id: { type: "string" },
      content: { type: "string" },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "cancelled"],
      },
    },
  },
  SessionMessageMeta: {
    type: "object",
    required: ["id", "seq", "createdAt"],
    properties: {
      id: { type: "string" },
      seq: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  SessionMessagesResponse: {
    type: "object",
    required: ["messages", "messageMeta", "todos"],
    properties: {
      messages: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      messageMeta: {
        type: "array",
        items: { $ref: "#/components/schemas/SessionMessageMeta" },
      },
      todos: {
        type: "array",
        items: { $ref: "#/components/schemas/AgentTodo" },
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
  DocumentAttachment: {
    type: "object",
    required: ["filename", "mediaType", "data"],
    properties: {
      filename: { type: "string" },
      mediaType: { type: "string" },
      data: { type: "string", description: "Base64-encoded document bytes" },
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
  MessageContentPartDocument: {
    type: "object",
    required: ["type", "filename", "mediaType", "data"],
    properties: {
      type: { type: "string", const: "document" },
      filename: { type: "string" },
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
      documents: {
        type: "array",
        items: { $ref: "#/components/schemas/DocumentAttachment" },
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
        required: ["type", "delta"],
        properties: {
          type: { type: "string", const: "thinking" },
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
        required: ["type", "todos"],
        properties: {
          type: { type: "string", const: "todos_updated" },
          todos: {
            type: "array",
            items: { $ref: "#/components/schemas/AgentTodo" },
          },
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
  CustomModelEntry: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      default: { type: "boolean" },
      inputPerMillionUsd: { type: "number" },
      outputPerMillionUsd: { type: "number" },
    },
  },
  ProviderModelOption: {
    type: "object",
    required: ["id", "name", "provider"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      provider: {
        type: "string",
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible"],
      },
      providerId: { type: "string" },
      providerLabel: { type: "string" },
      default: { type: "boolean" },
      inputPerMillionUsd: { type: "number" },
      outputPerMillionUsd: { type: "number" },
    },
  },
  ProviderInstanceSummary: {
    type: "object",
    required: ["id", "type", "label", "hasApiKey", "modelCount", "createdAt"],
    properties: {
      id: { type: "string" },
      type: {
        type: "string",
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible"],
      },
      label: { type: "string" },
      hasApiKey: { type: "boolean" },
      baseUrl: { type: ["string", "null"] },
      customModels: {
        type: "array",
        items: { $ref: "#/components/schemas/CustomModelEntry" },
      },
      modelCount: { type: "integer" },
      createdAt: { type: "string" },
    },
  },
  ListProvidersResponse: {
    type: "object",
    required: ["providers", "defaultProviderId", "defaultModel"],
    properties: {
      providers: {
        type: "array",
        items: { $ref: "#/components/schemas/ProviderInstanceSummary" },
      },
      defaultProviderId: { type: ["string", "null"] },
      defaultModel: { type: ["string", "null"] },
    },
  },
  CreateProviderRequest: {
    type: "object",
    required: ["type", "apiKey"],
    properties: {
      type: {
        type: "string",
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible"],
      },
      label: { type: "string" },
      apiKey: { type: "string" },
      model: { type: "string" },
      baseUrl: { type: "string" },
      customModels: {
        type: "array",
        items: { $ref: "#/components/schemas/CustomModelEntry" },
      },
    },
  },
  CreateProviderResponse: {
    type: "object",
    required: ["provider", "defaultProviderId", "defaultModel"],
    properties: {
      provider: { $ref: "#/components/schemas/ProviderInstanceSummary" },
      defaultProviderId: { type: "string" },
      defaultModel: { type: "string" },
    },
  },
  UpdateProviderRequest: {
    type: "object",
    properties: {
      label: { type: "string" },
      apiKey: { type: "string" },
      baseUrl: { type: "string" },
      customModels: {
        type: "array",
        items: { $ref: "#/components/schemas/CustomModelEntry" },
      },
    },
  },
  UpdateProviderResponse: {
    type: "object",
    required: ["provider"],
    properties: {
      provider: { $ref: "#/components/schemas/ProviderInstanceSummary" },
    },
  },
  DeleteProviderResponse: {
    type: "object",
    required: ["defaultProviderId", "defaultModel"],
    properties: {
      defaultProviderId: { type: ["string", "null"] },
      defaultModel: { type: ["string", "null"] },
    },
  },
  ModelsResponse: {
    type: "object",
    required: [
      "currentProviderId",
      "provider",
      "currentModel",
      "defaultModel",
      "displayName",
      "providers",
      "models",
    ],
    properties: {
      currentProviderId: { type: ["string", "null"] },
      provider: {
        type: ["string", "null"],
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible", null],
      },
      currentModel: { type: ["string", "null"] },
      defaultModel: { type: ["string", "null"] },
      displayName: { type: ["string", "null"] },
      providers: {
        type: "array",
        items: { $ref: "#/components/schemas/ProviderInstanceSummary" },
      },
      models: {
        type: "array",
        items: { $ref: "#/components/schemas/ProviderModelOption" },
      },
      catalog: {
        type: "array",
        items: { $ref: "#/components/schemas/ProviderModelOption" },
      },
    },
  },
  SetModelRequest: {
    type: "object",
    required: ["providerId", "model"],
    properties: {
      providerId: { type: "string" },
      model: { type: "string" },
    },
  },
  SetModelResponse: {
    type: "object",
    required: ["providerId", "provider", "currentModel"],
    properties: {
      providerId: { type: "string" },
      provider: {
        type: "string",
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible"],
      },
      currentModel: { type: "string" },
    },
  },
  ConfigureProviderRequest: {
    type: "object",
    required: ["apiKey", "provider"],
    properties: {
      apiKey: { type: "string" },
      model: { type: "string" },
      provider: {
        type: "string",
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible"],
      },
      displayName: { type: "string" },
      baseUrl: { type: "string" },
      customModels: {
        type: "array",
        items: { $ref: "#/components/schemas/CustomModelEntry" },
      },
    },
  },
  ConfigureProviderResponse: {
    type: "object",
    required: ["provider", "currentModel", "displayName"],
    properties: {
      provider: {
        type: "string",
        enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible"],
      },
      currentModel: { type: "string" },
      displayName: { type: ["string", "null"] },
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
  ToolDetail: {
    allOf: [
      { $ref: "#/components/schemas/ToolSummary" },
      {
        type: "object",
        required: ["handlerConfig", "createdAt", "updatedAt"],
        properties: {
          handlerConfig: {},
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    ],
  },
  ToolResponse: {
    type: "object",
    required: ["tool"],
    properties: {
      tool: { $ref: "#/components/schemas/ToolDetail" },
    },
  },
  ToolSourceResponse: {
    type: "object",
    required: ["path", "content", "language"],
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      language: { type: "string", enum: ["javascript", "typescript"] },
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
      "mcpServerCount",
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
      mcpServerCount: { type: "integer" },
      soulActive: { type: "boolean" },
      hasAvatar: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  McpServerSummary: {
    type: "object",
    required: [
      "id",
      "name",
      "transport",
      "enabled",
      "status",
      "toolCount",
      "lastError",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      transport: { type: "string", enum: ["http", "stdio"] },
      enabled: { type: "boolean" },
      status: { type: "string", enum: ["connected", "disconnected", "error"] },
      toolCount: { type: "integer" },
      lastError: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  CachedMcpToolSummary: {
    type: "object",
    required: ["name", "description"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      inputSchema: {},
    },
  },
  McpServerDetail: {
    allOf: [
      { $ref: "#/components/schemas/McpServerSummary" },
      {
        type: "object",
        required: ["config", "cachedTools"],
        properties: {
          config: { type: "object" },
          cachedTools: {
            type: "array",
            items: { $ref: "#/components/schemas/CachedMcpToolSummary" },
          },
        },
      },
    ],
  },
  ListMcpServersResponse: {
    type: "object",
    required: ["servers"],
    properties: {
      servers: {
        type: "array",
        items: { $ref: "#/components/schemas/McpServerSummary" },
      },
    },
  },
  McpServerResponse: {
    type: "object",
    required: ["server"],
    properties: {
      server: { $ref: "#/components/schemas/McpServerDetail" },
    },
  },
  CreateMcpServerRequest: {
    type: "object",
    required: ["name", "transport", "config"],
    properties: {
      name: { type: "string" },
      transport: { type: "string", enum: ["http", "stdio"] },
      config: { type: "object" },
      enabled: { type: "boolean" },
      connect: { type: "boolean" },
    },
  },
  UpdateMcpServerRequest: {
    type: "object",
    properties: {
      name: { type: "string" },
      transport: { type: "string", enum: ["http", "stdio"] },
      config: { type: "object" },
      enabled: { type: "boolean" },
    },
  },
  AssignMcpServerRequest: {
    type: "object",
    required: ["serverId"],
    properties: {
      serverId: { type: "string" },
    },
  },
  SkillSummary: {
    type: "object",
    required: [
      "id",
      "name",
      "description",
      "sourcePath",
      "hasTool",
      "disableModelInvocation",
      "enabled",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      sourcePath: { type: "string" },
      hasTool: { type: "boolean" },
      disableModelInvocation: { type: "boolean" },
      enabled: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  SkillDetail: {
    allOf: [
      { $ref: "#/components/schemas/SkillSummary" },
      {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string" },
        },
      },
    ],
  },
  ListSkillsResponse: {
    type: "object",
    required: ["skills"],
    properties: {
      skills: {
        type: "array",
        items: { $ref: "#/components/schemas/SkillSummary" },
      },
    },
  },
  SkillResponse: {
    type: "object",
    required: ["skill"],
    properties: {
      skill: { $ref: "#/components/schemas/SkillDetail" },
    },
  },
  AssignSkillRequest: {
    type: "object",
    required: ["skillId"],
    properties: {
      skillId: { type: "string" },
    },
  },
  SyncSkillsResponse: {
    type: "object",
    required: ["discovered", "created", "updated"],
    properties: {
      discovered: { type: "integer" },
      created: { type: "integer" },
      updated: { type: "integer" },
    },
  },
  TestMcpServerResponse: {
    type: "object",
    required: ["ok", "toolCount", "tools"],
    properties: {
      ok: { type: "boolean" },
      toolCount: { type: "integer" },
      tools: {
        type: "array",
        items: { $ref: "#/components/schemas/CachedMcpToolSummary" },
      },
      error: { type: "string" },
    },
  },
  McpStatus: {
    type: "object",
    required: ["serverCount", "connectedCount", "assignedProfileCount"],
    properties: {
      serverCount: { type: "integer" },
      connectedCount: { type: "integer" },
      assignedProfileCount: { type: "integer" },
    },
  },
  ProfileDetail: {
    allOf: [
      { $ref: "#/components/schemas/ProfileSummary" },
      {
        type: "object",
        required: ["systemPrompt", "tools", "mcpServers", "skills"],
        properties: {
          systemPrompt: { type: "string" },
          tools: {
            type: "array",
            items: { $ref: "#/components/schemas/ToolSummary" },
          },
          mcpServers: {
            type: "array",
            items: { $ref: "#/components/schemas/McpServerSummary" },
          },
          skills: {
            type: "array",
            items: { $ref: "#/components/schemas/SkillSummary" },
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
        items: { $ref: "#/components/schemas/ToolDetail" },
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
      tool: { $ref: "#/components/schemas/ToolDetail" },
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
  KnowledgeBaseDocument: {
    type: "object",
    required: ["id", "filename", "mediaType", "sizeBytes", "uploadedAt", "status"],
    properties: {
      id: { type: "string" },
      filename: { type: "string" },
      mediaType: { type: "string" },
      sizeBytes: { type: "integer" },
      uploadedAt: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["ready", "failed"] },
      error: { type: "string" },
    },
  },
  ListKnowledgeBaseResponse: {
    type: "object",
    required: ["documents", "profileId"],
    properties: {
      documents: {
        type: "array",
        items: { $ref: "#/components/schemas/KnowledgeBaseDocument" },
      },
      profileId: { type: "string" },
    },
  },
  UploadKnowledgeBaseRequest: {
    type: "object",
    required: ["document"],
    properties: {
      document: { $ref: "#/components/schemas/DocumentAttachment" },
    },
  },
  UploadKnowledgeBaseResponse: {
    type: "object",
    required: ["document", "profileId"],
    properties: {
      document: { $ref: "#/components/schemas/KnowledgeBaseDocument" },
      profileId: { type: "string" },
    },
  },
  DeleteKnowledgeBaseResponse: {
    type: "object",
    required: ["deleted", "profileId", "documentId"],
    properties: {
      deleted: { type: "boolean" },
      profileId: { type: "string" },
      documentId: { type: "string" },
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
  TelegramWorkerStatus: {
    type: "object",
    required: ["ok", "configured", "paired", "running"],
    properties: {
      ok: { type: "boolean" },
      configured: { type: "boolean" },
      paired: { type: "boolean" },
      running: { type: "boolean" },
    },
  },
  WhatsAppWorkerStatus: {
    type: "object",
    required: ["ok", "configured", "paired", "running"],
    properties: {
      ok: { type: "boolean" },
      configured: { type: "boolean" },
      paired: { type: "boolean" },
      running: { type: "boolean" },
      qrCode: { type: "string", nullable: true },
    },
  },
  LlmUsageStats: {
    type: "object",
    required: [
      "requestCount",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "estimatedCostUsd",
      "trackedSince",
    ],
    properties: {
      requestCount: { type: "integer" },
      inputTokens: { type: "integer" },
      outputTokens: { type: "integer" },
      totalTokens: { type: "integer" },
      estimatedCostUsd: { type: "number" },
      trackedSince: { type: "string" },
    },
  },
  LlmUsageStatus: {
    allOf: [
      { $ref: "#/components/schemas/LlmUsageStats" },
      {
        type: "object",
        required: [
          "provider",
          "currentModel",
          "providerConfigured",
          "displayName",
          "costEstimated",
        ],
        properties: {
          provider: {
            type: ["string", "null"],
            enum: ["openai", "anthropic", "openrouter", "gemini", "openai_compatible", null],
          },
          currentModel: { type: ["string", "null"] },
          providerConfigured: { type: "boolean" },
          displayName: { type: ["string", "null"] },
          costEstimated: { type: "boolean" },
        },
      },
    ],
  },
  SystemStatusResponse: {
    type: "object",
    required: [
      "server",
      "automationWorker",
      "taskWorker",
      "telegramWorker",
      "whatsappWorker",
      "llmUsage",
      "mcp",
      "checkedAt",
    ],
    properties: {
      server: { $ref: "#/components/schemas/HealthResponse" },
      automationWorker: { $ref: "#/components/schemas/AutomationWorkerStatus" },
      taskWorker: { $ref: "#/components/schemas/TaskWorkerStatus" },
      telegramWorker: { $ref: "#/components/schemas/TelegramWorkerStatus" },
      whatsappWorker: { $ref: "#/components/schemas/WhatsAppWorkerStatus" },
      llmUsage: { $ref: "#/components/schemas/LlmUsageStatus" },
      mcp: { $ref: "#/components/schemas/McpStatus" },
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
  DraftTaskPromptRequest: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      description: { type: "string" },
    },
  },
  DraftTaskPromptResponse: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string" },
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
  ThinkingEffort: {
    type: "string",
    enum: ["low", "medium", "high"],
  },
  ThinkingSettings: {
    type: "object",
    required: ["enabled", "effort"],
    properties: {
      enabled: { type: "boolean" },
      effort: { $ref: "#/components/schemas/ThinkingEffort" },
    },
  },
  ThinkingSettingsResponse: {
    type: "object",
    required: ["thinking"],
    properties: {
      thinking: { $ref: "#/components/schemas/ThinkingSettings" },
    },
  },
  UpdateThinkingRequest: {
    type: "object",
    required: ["enabled"],
    properties: {
      enabled: { type: "boolean" },
      effort: { $ref: "#/components/schemas/ThinkingEffort" },
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
  WhatsAppSettingsResponse: {
    type: "object",
    required: [
      "configured",
      "phoneNumberMasked",
      "pairingCode",
      "pairedJid",
      "profileId",
    ],
    properties: {
      configured: { type: "boolean" },
      phoneNumberMasked: { type: "string", nullable: true },
      pairingCode: { type: "string", nullable: true },
      pairedJid: { type: "string", nullable: true },
      profileId: { type: "string" },
    },
  },
  UpdateWhatsAppSettingsRequest: {
    type: "object",
    properties: {
      phoneNumber: { type: "string" },
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
