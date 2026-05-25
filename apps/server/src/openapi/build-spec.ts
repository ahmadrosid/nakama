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
      { name: "Chat" },
      { name: "Models" },
      { name: "Profiles" },
      { name: "Tools" },
      { name: "Automations" },
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
      "/v1/settings/model": {
        put: {
          tags: ["Models"],
          summary: "Switch the active model",
          operationId: "setModel",
          requestBody: jsonBody("SetModelRequest"),
          responses: {
            "200": jsonResponse("SetModelResponse", "Model updated"),
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
                      "SSE data lines with StreamEvent JSON payloads (chunk, tool_start, tool_end, done, error)",
                  },
                },
              },
            },
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
      "/v1/soul": {
        get: {
          tags: ["Soul"],
          summary: "Get global soul status",
          operationId: "getSoulStatus",
          responses: {
            "200": jsonResponse("SoulStatusResponse", "Soul status"),
          },
        },
      },
      "/v1/soul/stack": {
        get: {
          tags: ["Soul"],
          summary: "Get global soul stack contents",
          operationId: "getSoulStack",
          responses: {
            "200": jsonResponse("SoulStackResponse", "Soul stack"),
          },
        },
      },
      "/v1/soul/files/{fileKey}": {
        put: {
          tags: ["Soul"],
          summary: "Write a global soul file",
          operationId: "writeSoulFile",
          parameters: [
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
      "/v1/soul/init": {
        post: {
          tags: ["Soul"],
          summary: "Initialize global soul templates",
          operationId: "initSoul",
          responses: {
            "201": jsonResponse("InitSoulResponse", "Soul initialized"),
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
