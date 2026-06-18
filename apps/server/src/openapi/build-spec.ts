import { DEFAULT_SERVER_URL, TINYCLAW_API_VERSION } from "@tinyclaw/core";
import { openApiParameters, openApiSchemas } from "./schemas";

type JsonSchemaName = keyof typeof openApiSchemas;

function ref(name: JsonSchemaName) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonResponse(name: JsonSchemaName, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: ref(name),
      },
    },
  };
}

function jsonBody(name: JsonSchemaName) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: ref(name),
      },
    },
  };
}

const errorResponse = {
  description: "Error",
  content: {
    "application/json": {
      schema: ref("ApiErrorResponse"),
    },
  },
};

export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "TinyClaw API",
      version: String(TINYCLAW_API_VERSION),
      description: "HTTP API for the TinyClaw personal AI assistant.",
    },
    servers: [
      {
        url: DEFAULT_SERVER_URL,
        description: "Local dev server",
      },
    ],
    tags: [
      { name: "Health" },
      { name: "Workers" },
      { name: "Chat" },
      { name: "Models" },
      { name: "Profiles" },
      { name: "Tools" },
      { name: "Automations" },
      { name: "Tasks" },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          operationId: "getHealth",
          responses: {
            "200": jsonResponse("HealthResponse", "Server is healthy"),
          },
        },
      },
      "/v1/system/status": {
        get: {
          tags: ["Health"],
          summary: "System status",
          operationId: "getSystemStatus",
          responses: {
            "200": jsonResponse("SystemStatusResponse", "Server and automation worker status"),
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["Health"],
          summary: "OpenAPI specification",
          operationId: "getOpenApiSpec",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/v1/models": {
        get: {
          tags: ["Models"],
          summary: "List available models",
          operationId: "listModels",
          responses: {
            "200": jsonResponse("ModelsResponse", "Model catalog"),
          },
        },
      },
      "/v1/providers": {
        get: {
          tags: ["Models"],
          summary: "List configured provider instances",
          operationId: "listProviders",
          responses: {
            "200": jsonResponse("ListProvidersResponse", "Provider instances"),
          },
        },
        post: {
          tags: ["Models"],
          summary: "Add a provider instance",
          operationId: "createProvider",
          requestBody: jsonBody("CreateProviderRequest"),
          responses: {
            "200": jsonResponse("CreateProviderResponse", "Provider created"),
            "500": errorResponse,
          },
        },
      },
      "/v1/providers/{providerId}": {
        patch: {
          tags: ["Models"],
          summary: "Update a provider instance",
          operationId: "updateProvider",
          parameters: [
            {
              name: "providerId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: jsonBody("UpdateProviderRequest"),
          responses: {
            "200": jsonResponse("UpdateProviderResponse", "Provider updated"),
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["Models"],
          summary: "Remove a provider instance",
          operationId: "deleteProvider",
          parameters: [
            {
              name: "providerId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("DeleteProviderResponse", "Provider removed"),
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/provider": {
        put: {
          tags: ["Models"],
          summary: "Configure the LLM provider and API key",
          operationId: "configureProvider",
          requestBody: jsonBody("ConfigureProviderRequest"),
          responses: {
            "200": jsonResponse("ConfigureProviderResponse", "Provider configured"),
            "500": errorResponse,
          },
        },
      },
      "/v1/timezones": {
        get: {
          tags: ["Models"],
          summary: "List available timezones",
          operationId: "listTimezones",
          responses: {
            "200": jsonResponse("ListTimezonesResponse", "Timezone catalog"),
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/timezone": {
        get: {
          tags: ["Models"],
          summary: "Get the user timezone",
          operationId: "getTimezone",
          responses: {
            "200": jsonResponse("TimezoneSettingsResponse", "Timezone settings"),
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Models"],
          summary: "Update the user timezone",
          operationId: "setTimezone",
          requestBody: jsonBody("UpdateTimezoneRequest"),
          responses: {
            "200": jsonResponse("TimezoneSettingsResponse", "Timezone updated"),
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/thinking": {
        get: {
          tags: ["Models"],
          summary: "Get extended thinking settings",
          operationId: "getThinkingSettings",
          responses: {
            "200": jsonResponse("ThinkingSettingsResponse", "Thinking settings"),
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Models"],
          summary: "Update extended thinking settings",
          operationId: "setThinkingSettings",
          requestBody: jsonBody("UpdateThinkingRequest"),
          responses: {
            "200": jsonResponse("ThinkingSettingsResponse", "Thinking settings updated"),
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/telegram": {
        get: {
          tags: ["Models"],
          summary: "Get Telegram bridge settings",
          operationId: "getTelegramSettings",
          responses: {
            "200": jsonResponse("TelegramSettingsResponse", "Telegram settings"),
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Models"],
          summary: "Update Telegram bridge settings",
          operationId: "setTelegramSettings",
          requestBody: jsonBody("UpdateTelegramSettingsRequest"),
          responses: {
            "200": jsonResponse("TelegramSettingsResponse", "Telegram settings updated"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/telegram/handshake": {
        post: {
          tags: ["Models"],
          summary: "Regenerate Telegram pairing code",
          operationId: "regenerateTelegramHandshake",
          responses: {
            "200": jsonResponse("TelegramSettingsResponse", "Pairing code regenerated"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/whatsapp": {
        get: {
          tags: ["Models"],
          summary: "Get WhatsApp bridge settings",
          operationId: "getWhatsAppSettings",
          responses: {
            "200": jsonResponse("WhatsAppSettingsResponse", "WhatsApp settings"),
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Models"],
          summary: "Update WhatsApp bridge settings",
          operationId: "setWhatsAppSettings",
          requestBody: jsonBody("UpdateWhatsAppSettingsRequest"),
          responses: {
            "200": jsonResponse("WhatsAppSettingsResponse", "WhatsApp settings updated"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/whatsapp/pairing-code": {
        post: {
          tags: ["Models"],
          summary: "Regenerate WhatsApp pairing code",
          operationId: "regenerateWhatsAppPairingCode",
          responses: {
            "200": jsonResponse("WhatsAppSettingsResponse", "Pairing code regenerated"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/settings/whatsapp/reconnect": {
        post: {
          tags: ["Models"],
          summary: "Reset WhatsApp session and restart worker for QR reconnect",
          operationId: "reconnectWhatsApp",
          responses: {
            "200": jsonResponse("WhatsAppSettingsResponse", "WhatsApp session reset for QR reconnect"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/user/context": {
        get: {
          tags: ["User"],
          summary: "Get USER.md status",
          operationId: "getUserContext",
          parameters: [
            {
              name: "content",
              in: "query",
              required: false,
              schema: { type: "boolean" },
              description: "Include file contents when true.",
            },
          ],
          responses: {
            "200": jsonResponse("UserContextStatusResponse", "User context status"),
            "500": errorResponse,
          },
        },
        put: {
          tags: ["User"],
          summary: "Write USER.md",
          operationId: "writeUserContext",
          requestBody: jsonBody("UpdateUserContextRequest"),
          responses: {
            "204": { description: "User context saved" },
            "500": errorResponse,
          },
        },
      },
      "/v1/user/context/init": {
        post: {
          tags: ["User"],
          summary: "Initialize USER.md template",
          operationId: "initUserContext",
          responses: {
            "201": jsonResponse("InitUserContextResponse", "User context initialized"),
            "500": errorResponse,
          },
        },
      },
      "/v1/sessions": {
        get: {
          tags: ["Chat"],
          summary: "List saved chat sessions",
          operationId: "listSessions",
          parameters: [
            {
              name: "profileId",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "channel",
              in: "query",
              schema: { $ref: "#/components/schemas/AgentChannel" },
            },
          ],
          responses: {
            "200": jsonResponse("ListSessionsResponse", "Saved chat sessions"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
        post: {
          tags: ["Chat"],
          summary: "Create a chat session",
          operationId: "createSession",
          requestBody: jsonBody("CreateSessionRequest"),
          responses: {
            "201": jsonResponse("CreateSessionResponse", "Session created"),
            "500": errorResponse,
          },
        },
      },
      "/v1/sessions/{sessionId}": {
        delete: {
          tags: ["Chat"],
          summary: "Clear or delete a chat session",
          description:
            "Clears stored messages by default. Pass purge=true to delete the session record.",
          operationId: "clearSession",
          parameters: [
            { $ref: "#/components/parameters/SessionId" },
            {
              name: "purge",
              in: "query",
              schema: { type: "boolean" },
              description: "Delete the session record entirely",
            },
          ],
          responses: {
            "204": { description: "Session cleared or deleted" },
            "404": errorResponse,
          },
        },
      },
      "/v1/sessions/{sessionId}/messages": {
        get: {
          tags: ["Chat"],
          summary: "List chat messages for a session",
          operationId: "getSessionMessages",
          parameters: [{ $ref: "#/components/parameters/SessionId" }],
          responses: {
            "200": jsonResponse("SessionMessagesResponse", "Stored chat messages"),
            "404": errorResponse,
          },
        },
        post: {
          tags: ["Chat"],
          summary: "Send a chat message",
          description:
            "Returns JSON by default. Set stream=true, ?stream=true, or Accept: text/event-stream for SSE.",
          operationId: "sendMessage",
          parameters: [
            { $ref: "#/components/parameters/SessionId" },
            {
              name: "stream",
              in: "query",
              schema: { type: "boolean" },
              description: "Enable SSE streaming",
            },
          ],
          requestBody: jsonBody("SendMessageRequest"),
          responses: {
            "200": {
              description: "Assistant reply",
              content: {
                "application/json": {
                  schema: ref("SendMessageResponse"),
                },
                "text/event-stream": {
                  schema: {
                    type: "string",
                    description:
                      "SSE data lines with StreamEvent JSON payloads (chunk, tool_start, tool_end, todos_updated, done, error)",
                  },
                },
              },
            },
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/sessions/{sessionId}/branch": {
        post: {
          tags: ["Chat"],
          summary: "Create a branched chat session from a message checkpoint",
          operationId: "branchSession",
          parameters: [{ $ref: "#/components/parameters/SessionId" }],
          requestBody: jsonBody("BranchSessionRequest"),
          responses: {
            "201": jsonResponse("BranchSessionResponse", "Created branched session"),
            "400": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/v1/sessions/{sessionId}/compact": {
        post: {
          tags: ["Chat"],
          summary: "Compact chat session history",
          operationId: "compactSession",
          parameters: [{ $ref: "#/components/parameters/SessionId" }],
          requestBody: jsonBody("CompactSessionRequest"),
          responses: {
            "200": jsonResponse("CompactionResponse", "Compaction result"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles": {
        get: {
          tags: ["Profiles"],
          summary: "List bot profiles",
          operationId: "listProfiles",
          responses: {
            "200": jsonResponse("ListProfilesResponse", "Profile list"),
          },
        },
        post: {
          tags: ["Profiles"],
          summary: "Create a bot profile",
          operationId: "createProfile",
          requestBody: jsonBody("CreateProfileRequest"),
          responses: {
            "201": jsonResponse("ProfileResponse", "Profile created"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}": {
        get: {
          tags: ["Profiles"],
          summary: "Get a bot profile",
          operationId: "getProfile",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "200": jsonResponse("ProfileResponse", "Profile detail"),
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Profiles"],
          summary: "Update a bot profile",
          operationId: "updateProfile",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          requestBody: jsonBody("UpdateProfileRequest"),
          responses: {
            "200": jsonResponse("ProfileResponse", "Profile updated"),
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["Profiles"],
          summary: "Delete a bot profile",
          operationId: "deleteProfile",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "204": { description: "Profile deleted" },
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/knowledge-base": {
        get: {
          tags: ["Profiles"],
          summary: "List knowledge base documents for a profile",
          operationId: "listKnowledgeBase",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "200": jsonResponse("ListKnowledgeBaseResponse", "Knowledge base documents"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        post: {
          tags: ["Profiles"],
          summary: "Upload a knowledge base document",
          operationId: "uploadKnowledgeBaseDocument",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          requestBody: jsonBody("UploadKnowledgeBaseRequest"),
          responses: {
            "201": jsonResponse("UploadKnowledgeBaseResponse", "Uploaded knowledge base document"),
            "400": errorResponse,
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/knowledge-base/{documentId}": {
        delete: {
          tags: ["Profiles"],
          summary: "Delete a knowledge base document",
          operationId: "deleteKnowledgeBaseDocument",
          parameters: [
            { $ref: "#/components/parameters/ProfileId" },
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("DeleteKnowledgeBaseResponse", "Deleted knowledge base document"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/avatar": {
        get: {
          tags: ["Profiles"],
          summary: "Get a profile avatar image",
          operationId: "getProfileAvatar",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "200": {
              description: "Profile avatar image",
              content: {
                "image/*": { schema: { type: "string", format: "binary" } },
              },
            },
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Profiles"],
          summary: "Upload a profile avatar",
          operationId: "uploadProfileAvatar",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          requestBody: jsonBody("ImageAttachment"),
          responses: {
            "200": jsonResponse("ProfileResponse", "Profile with updated avatar"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["Profiles"],
          summary: "Delete a profile avatar",
          operationId: "deleteProfileAvatar",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "204": { description: "Avatar deleted" },
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/skills": {
        get: {
          tags: ["Skills"],
          summary: "List discovered skills",
          operationId: "listSkills",
          responses: {
            "200": jsonResponse("ListSkillsResponse", "Skill list"),
          },
        },
      },
      "/v1/skills/sync": {
        post: {
          tags: ["Skills"],
          summary: "Sync skills from disk into the database",
          operationId: "syncSkills",
          responses: {
            "200": jsonResponse("SyncSkillsResponse", "Skills synced"),
          },
        },
      },
      "/v1/skills/{skillId}": {
        get: {
          tags: ["Skills"],
          summary: "Get a skill",
          operationId: "getSkill",
          parameters: [
            {
              name: "skillId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("SkillResponse", "Skill detail"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/skills": {
        post: {
          tags: ["Profiles", "Skills"],
          summary: "Assign a skill to a profile",
          operationId: "assignSkillToProfile",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          requestBody: jsonBody("AssignSkillRequest"),
          responses: {
            "200": jsonResponse("ProfileResponse", "Skill assigned"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/skills/{skillId}": {
        delete: {
          tags: ["Profiles", "Skills"],
          summary: "Unassign a skill from a profile",
          operationId: "unassignSkillFromProfile",
          parameters: [
            { $ref: "#/components/parameters/ProfileId" },
            {
              name: "skillId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("ProfileResponse", "Skill unassigned"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/mcp-servers": {
        post: {
          tags: ["Profiles", "MCP"],
          summary: "Assign an MCP server to a profile",
          operationId: "assignMcpServerToProfile",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          requestBody: jsonBody("AssignMcpServerRequest"),
          responses: {
            "200": jsonResponse("ProfileResponse", "MCP server assigned"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/mcp-servers/{serverId}": {
        delete: {
          tags: ["Profiles", "MCP"],
          summary: "Unassign an MCP server from a profile",
          operationId: "unassignMcpServerFromProfile",
          parameters: [
            { $ref: "#/components/parameters/ProfileId" },
            {
              name: "serverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("ProfileResponse", "MCP server unassigned"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/tools": {
        get: {
          tags: ["Profiles", "Tools"],
          summary: "List tools assigned to a profile",
          operationId: "listProfileTools",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "200": jsonResponse("ListToolsResponse", "Tool list"),
            "500": errorResponse,
          },
        },
        post: {
          tags: ["Profiles", "Tools"],
          summary: "Assign a tool to a profile",
          operationId: "assignToolToProfile",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          requestBody: jsonBody("AssignToolRequest"),
          responses: {
            "200": jsonResponse("ProfileResponse", "Tool assigned"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/tools/{toolId}": {
        delete: {
          tags: ["Profiles", "Tools"],
          summary: "Unassign a tool from a profile",
          operationId: "unassignToolFromProfile",
          parameters: [
            { $ref: "#/components/parameters/ProfileId" },
            { $ref: "#/components/parameters/ToolId" },
          ],
          responses: {
            "200": jsonResponse("ProfileResponse", "Tool unassigned"),
            "500": errorResponse,
          },
        },
      },
      "/v1/mcp/servers": {
        get: {
          tags: ["MCP"],
          summary: "List MCP servers",
          operationId: "listMcpServers",
          responses: {
            "200": jsonResponse("ListMcpServersResponse", "MCP server list"),
          },
        },
        post: {
          tags: ["MCP"],
          summary: "Create an MCP server",
          operationId: "createMcpServer",
          requestBody: jsonBody("CreateMcpServerRequest"),
          responses: {
            "201": jsonResponse("McpServerResponse", "MCP server created"),
            "500": errorResponse,
          },
        },
      },
      "/v1/mcp/servers/test": {
        post: {
          tags: ["MCP"],
          summary: "Test an MCP server connection",
          operationId: "testMcpServer",
          requestBody: jsonBody("CreateMcpServerRequest"),
          responses: {
            "200": jsonResponse("TestMcpServerResponse", "MCP test result"),
            "500": errorResponse,
          },
        },
      },
      "/v1/mcp/servers/{serverId}": {
        get: {
          tags: ["MCP"],
          summary: "Get an MCP server",
          operationId: "getMcpServer",
          parameters: [
            {
              name: "serverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("McpServerResponse", "MCP server detail"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        patch: {
          tags: ["MCP"],
          summary: "Update an MCP server",
          operationId: "updateMcpServer",
          parameters: [
            {
              name: "serverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: jsonBody("UpdateMcpServerRequest"),
          responses: {
            "200": jsonResponse("McpServerResponse", "MCP server updated"),
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["MCP"],
          summary: "Delete an MCP server",
          operationId: "deleteMcpServer",
          parameters: [
            {
              name: "serverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "204": { description: "MCP server deleted" },
            "500": errorResponse,
          },
        },
      },
      "/v1/mcp/servers/{serverId}/connect": {
        post: {
          tags: ["MCP"],
          summary: "Connect an MCP server",
          operationId: "connectMcpServer",
          parameters: [
            {
              name: "serverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("McpServerResponse", "MCP server connected"),
            "500": errorResponse,
          },
        },
      },
      "/v1/mcp/servers/{serverId}/sync": {
        post: {
          tags: ["MCP"],
          summary: "Sync tools from an MCP server",
          operationId: "syncMcpServer",
          parameters: [
            {
              name: "serverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("McpServerResponse", "MCP server synced"),
            "500": errorResponse,
          },
        },
      },
      "/v1/tools": {
        get: {
          tags: ["Tools"],
          summary: "List all tools",
          operationId: "listTools",
          responses: {
            "200": jsonResponse("ListToolsResponse", "Tool list"),
          },
        },
        post: {
          tags: ["Tools"],
          summary: "Register a tool",
          operationId: "createTool",
          requestBody: jsonBody("CreateToolRequest"),
          responses: {
            "201": jsonResponse("CreateToolResponse", "Tool created"),
            "500": errorResponse,
          },
        },
      },
      "/v1/tools/{toolId}": {
        get: {
          tags: ["Tools"],
          summary: "Get a tool",
          operationId: "getTool",
          parameters: [
            {
              name: "toolId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("ToolResponse", "Tool detail"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["Tools"],
          summary: "Delete a registered tool",
          operationId: "deleteTool",
          parameters: [
            {
              name: "toolId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "204": { description: "Tool deleted" },
            "500": errorResponse,
          },
        },
      },
      "/v1/tools/{toolId}/source": {
        get: {
          tags: ["Tools"],
          summary: "Get tool source code",
          operationId: "getToolSource",
          parameters: [
            {
              name: "toolId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("ToolSourceResponse", "Tool source"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/soul": {
        get: {
          tags: ["Soul", "Profiles"],
          summary: "Get soul status for a profile",
          operationId: "getProfileSoulStatus",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "200": jsonResponse("SoulStatusResponse", "Soul status"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/soul/stack": {
        get: {
          tags: ["Soul", "Profiles"],
          summary: "Get soul stack contents for a profile",
          operationId: "getProfileSoulStack",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "200": jsonResponse("SoulStackResponse", "Soul stack"),
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/soul/files/{fileKey}": {
        put: {
          tags: ["Soul", "Profiles"],
          summary: "Write a profile soul file",
          operationId: "writeProfileSoulFile",
          parameters: [
            { $ref: "#/components/parameters/ProfileId" },
            {
              name: "fileKey",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["soul", "style", "skill", "memory"] },
            },
          ],
          requestBody: jsonBody("UpdateSoulFileRequest"),
          responses: {
            "204": { description: "File saved" },
            "500": errorResponse,
          },
        },
      },
      "/v1/profiles/{profileId}/soul/init": {
        post: {
          tags: ["Soul", "Profiles"],
          summary: "Initialize soul templates for a profile",
          operationId: "initProfileSoul",
          parameters: [{ $ref: "#/components/parameters/ProfileId" }],
          responses: {
            "201": jsonResponse("InitSoulResponse", "Soul initialized"),
            "500": errorResponse,
          },
        },
      },
      "/v1/automations/draft": {
        post: {
          tags: ["Automations"],
          summary: "Draft an automation from a prompt",
          operationId: "draftAutomation",
          requestBody: jsonBody("DraftAutomationRequest"),
          responses: {
            "200": jsonResponse("DraftAutomationResponse", "Automation draft"),
            "500": errorResponse,
          },
        },
      },
      "/v1/automations": {
        get: {
          tags: ["Automations"],
          summary: "List saved automations",
          operationId: "listAutomations",
          responses: {
            "200": jsonResponse("ListAutomationsResponse", "Saved automations"),
            "500": errorResponse,
          },
        },
        post: {
          tags: ["Automations"],
          summary: "Create a saved automation",
          operationId: "createAutomation",
          requestBody: jsonBody("CreateAutomationRequest"),
          responses: {
            "201": jsonResponse("AutomationResponse", "Automation created"),
            "500": errorResponse,
          },
        },
      },
      "/v1/automations/{automationId}": {
        get: {
          tags: ["Automations"],
          summary: "Get a saved automation",
          operationId: "getAutomation",
          parameters: [{ $ref: "#/components/parameters/AutomationId" }],
          responses: {
            "200": jsonResponse("AutomationResponse", "Automation"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        put: {
          tags: ["Automations"],
          summary: "Update a saved automation",
          operationId: "updateAutomation",
          parameters: [{ $ref: "#/components/parameters/AutomationId" }],
          requestBody: jsonBody("UpdateAutomationRequest"),
          responses: {
            "200": jsonResponse("AutomationResponse", "Automation updated"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["Automations"],
          summary: "Delete a saved automation",
          operationId: "deleteAutomation",
          parameters: [{ $ref: "#/components/parameters/AutomationId" }],
          responses: {
            "204": { description: "Automation deleted" },
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/automations/{automationId}/run": {
        post: {
          tags: ["Automations"],
          summary: "Run an automation now",
          operationId: "runAutomation",
          parameters: [{ $ref: "#/components/parameters/AutomationId" }],
          responses: {
            "200": jsonResponse("RunAutomationResponse", "Automation run"),
            "404": errorResponse,
            "409": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/automations/{automationId}/runs": {
        get: {
          tags: ["Automations"],
          summary: "List automation run history",
          operationId: "listAutomationRuns",
          parameters: [{ $ref: "#/components/parameters/AutomationId" }],
          responses: {
            "200": jsonResponse("ListAutomationRunsResponse", "Automation runs"),
            "404": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/tasks/draft-prompt": {
        post: {
          tags: ["Tasks"],
          summary: "Draft an agent prompt from task title and description",
          operationId: "draftTaskPrompt",
          requestBody: jsonBody("DraftTaskPromptRequest"),
          responses: {
            "200": jsonResponse("DraftTaskPromptResponse", "Generated prompt"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/tasks": {
        get: {
          tags: ["Tasks"],
          summary: "List all tasks",
          operationId: "listTasks",
          responses: {
            "200": jsonResponse("ListTasksResponse", "Tasks"),
          },
        },
        post: {
          tags: ["Tasks"],
          summary: "Create a task",
          operationId: "createTask",
          requestBody: jsonBody("CreateTaskRequest"),
          responses: {
            "201": jsonResponse("TaskResponse", "Task created"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/tasks/{taskId}": {
        get: {
          tags: ["Tasks"],
          summary: "Get a task",
          operationId: "getTask",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: {
            "200": jsonResponse("TaskResponse", "Task"),
            "404": errorResponse,
          },
        },
        put: {
          tags: ["Tasks"],
          summary: "Update a task",
          operationId: "updateTask",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          requestBody: jsonBody("UpdateTaskRequest"),
          responses: {
            "200": jsonResponse("TaskResponse", "Task updated"),
            "400": errorResponse,
            "404": errorResponse,
            "500": errorResponse,
          },
        },
        delete: {
          tags: ["Tasks"],
          summary: "Delete a task",
          operationId: "deleteTask",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: {
            "204": { description: "Task deleted" },
            "404": errorResponse,
          },
        },
      },
      "/v1/tasks/{taskId}/run": {
        post: {
          tags: ["Tasks"],
          summary: "Run a task now",
          operationId: "runTask",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: {
            "200": jsonResponse("RunTaskResponse", "Task run"),
            "404": errorResponse,
            "409": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/tasks/{taskId}/runs": {
        get: {
          tags: ["Tasks"],
          summary: "List task run history",
          operationId: "listTaskRuns",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: {
            "200": jsonResponse("ListTaskRunsResponse", "Task runs"),
            "404": errorResponse,
          },
        },
      },
      "/v1/tasks/{taskId}/messages": {
        get: {
          tags: ["Tasks"],
          summary: "Get task chat messages",
          operationId: "getTaskMessages",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: {
            "200": jsonResponse("TaskMessagesResponse", "Task chat messages"),
            "404": errorResponse,
          },
        },
      },
      "/v1/workers/{name}/start": {
        post: {
          tags: ["Workers"],
          summary: "Start a background worker",
          operationId: "startWorker",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["telegram", "whatsapp"] },
            },
          ],
          responses: {
            "200": {
              description: "Worker started",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/workers/{name}/stop": {
        post: {
          tags: ["Workers"],
          summary: "Stop a background worker",
          operationId: "stopWorker",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["telegram", "whatsapp"] },
            },
          ],
          responses: {
            "200": {
              description: "Worker stopped",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/workers/{name}/restart": {
        post: {
          tags: ["Workers"],
          summary: "Restart a background worker",
          operationId: "restartWorker",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["telegram", "whatsapp"] },
            },
          ],
          responses: {
            "200": {
              description: "Worker restarted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/workers/{name}/logs": {
        get: {
          tags: ["Workers"],
          summary: "Get recent worker logs",
          operationId: "getWorkerLogs",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["telegram", "whatsapp"] },
            },
            {
              name: "lines",
              in: "query",
              required: false,
              schema: { type: "integer", default: 200, minimum: 1, maximum: 2000 },
              description: "Number of log lines to return",
            },
          ],
          responses: {
            "200": jsonResponse("WorkerLogsResponse", "Worker logs"),
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
      "/v1/workers/{name}/clear-logs": {
        post: {
          tags: ["Workers"],
          summary: "Clear worker logs",
          operationId: "clearWorkerLogs",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["telegram", "whatsapp"] },
            },
          ],
          responses: {
            "200": {
              description: "Logs cleared",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
            "400": errorResponse,
            "500": errorResponse,
          },
        },
      },
    },
    components: {
      parameters: openApiParameters,
      schemas: openApiSchemas,
    },
  };
}

export function serializeOpenApiSpec(spec = buildOpenApiSpec()): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
