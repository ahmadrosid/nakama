import type {
  AgentChannel,
  AssignToolRequest,
  ChatMessage,
  CreateProfileRequest,
  CreateSessionResponse,
  CreateToolRequest,
  DraftAutomationResponse,
  HealthResponse,
  ImageAttachment,
  InitSoulResponse,
  InitUserContextResponse,
  ListProfilesResponse,
  ListToolsResponse,
  ListSessionsResponse,
  ModelsResponse,
  ProfileResponse,
  ProfileSummary,
  SendMessageInput,
  SendMessageResponse,
  SessionMessagesResponse,
  SetModelResponse,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CompactionResponse,
  SoulStackResponse,
  SoulStatusResponse,
  StreamEvent,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UpdateUserContextRequest,
  UserContextStatusResponse,
  AutomationDefinition,
  AutomationRunRecord,
  CreateAutomationRequest,
  ListAutomationRunsResponse,
  ListAutomationsResponse,
  AutomationResponse,
  RunAutomationResponse,
  StoredAutomation,
  SystemStatusResponse,
  TelegramSettingsResponse,
  TimezoneSettingsResponse,
  UpdateAutomationRequest,
  UpdateTelegramSettingsRequest,
  UpdateTimezoneRequest,
  ListTimezonesResponse,
} from "@tinyclaw/core/contract";
import {
  readApiErrorMessage,
  TinyClawApiError,
} from "@tinyclaw/core/api-error";
import { resolveServerUrl } from "@tinyclaw/core/runtime";

export interface TinyClawClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export type StreamHandler = (delta: string) => void;

export interface StreamHandlers {
  onChunk: StreamHandler;
  onToolStart?: (event: {
    toolCallId: string;
    tool: string;
    input: Record<string, unknown>;
  }) => void;
  onToolEnd?: (event: {
    toolCallId: string;
    tool: string;
    result: unknown;
  }) => void;
}

export type SendMessageArg = string | SendMessageInput;

export interface SendStreamOptions {
  signal?: AbortSignal;
}

export interface RemoteChatSession {
  id: string;
  send(input: SendMessageArg): Promise<string>;
  sendStream(
    input: SendMessageArg,
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions,
  ): Promise<string>;
  compact(options?: { force?: boolean }): Promise<CompactionResponse>;
  clear(): Promise<void>;
  purge(): Promise<void>;
  getMessages(): Promise<ChatMessage[]>;
  createAutomation(prompt: string): Promise<AutomationDefinition>;
}

export class TinyClawClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TinyClawClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveServerUrl()).replace(/\/$/, "");
    const fetchFn = options.fetch ?? fetch;
    this.fetchImpl = ((input, init) => fetchFn(input, init)) as typeof fetch;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  async getSystemStatus(): Promise<SystemStatusResponse> {
    return this.request<SystemStatusResponse>("/v1/system/status");
  }

  async getModels(): Promise<ModelsResponse> {
    return this.request<ModelsResponse>("/v1/models");
  }

  async setModel(model: string): Promise<SetModelResponse> {
    return this.request<SetModelResponse>("/v1/settings/model", {
      method: "PUT",
      body: JSON.stringify({ model }),
    });
  }

  async configureProvider(
    request: ConfigureProviderRequest,
  ): Promise<ConfigureProviderResponse> {
    return this.request<ConfigureProviderResponse>("/v1/settings/provider", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async createSession(
    channel: AgentChannel,
    options: { profileId?: string } = {},
  ): Promise<RemoteChatSession> {
    const response = await this.request<CreateSessionResponse>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ channel, profileId: options.profileId }),
    });

    return this.createChatSession(response.sessionId, channel);
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
    return this.request<SessionMessagesResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
  }

  async listSessions(
    profileId: string,
    channel: AgentChannel = "web",
  ): Promise<ListSessionsResponse> {
    const query = new URLSearchParams({ profileId, channel });
    return this.request<ListSessionsResponse>(`/v1/sessions?${query.toString()}`);
  }

  async listProfiles(): Promise<ListProfilesResponse> {
    return this.request<ListProfilesResponse>("/v1/profiles");
  }

  async getProfile(profileId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(`/v1/profiles/${encodeURIComponent(profileId)}`);
  }

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/v1/profiles", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}`,
      {
        method: "PUT",
        body: JSON.stringify(request),
      },
    );
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment,
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/avatar`,
      {
        method: "PUT",
        body: JSON.stringify(attachment),
      },
    );
  }

  async deleteProfileAvatar(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}/avatar`, {
      method: "DELETE",
    });
  }

  async listTools(): Promise<ListToolsResponse> {
    return this.request<ListToolsResponse>("/v1/tools");
  }

  async createTool(request: CreateToolRequest) {
    return this.request<{ tool: ListToolsResponse["tools"][number] }>("/v1/tools", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async deleteTool(toolId: string): Promise<void> {
    await this.request(`/v1/tools/${encodeURIComponent(toolId)}`, {
      method: "DELETE",
    });
  }

  async assignTool(profileId: string, request: AssignToolRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async unassignTool(profileId: string, toolId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools/${encodeURIComponent(toolId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async getSoulStatus(options: { includeContents?: boolean } = {}): Promise<SoulStatusResponse> {
    const query = options.includeContents ? "?contents=true" : "";
    return this.request<SoulStatusResponse>(`/v1/soul${query}`);
  }

  async initSoul(): Promise<InitSoulResponse> {
    return this.request<InitSoulResponse>("/v1/soul/init", {
      method: "POST",
    });
  }

  async getProfileSoulStatus(
    profileId: string,
    options: { includeContents?: boolean } = {},
  ): Promise<SoulStatusResponse> {
    const query = options.includeContents ? "?contents=true" : "";
    return this.request<SoulStatusResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul${query}`,
    );
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    return this.request<InitSoulResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/init`,
      {
        method: "POST",
      },
    );
  }

  async getSoulStack(): Promise<SoulStackResponse> {
    return this.request<SoulStackResponse>("/v1/soul/stack");
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    return this.request<SoulStackResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/stack`,
    );
  }

  async writeSoulFile(fileKey: string, content: string): Promise<void> {
    await this.request(`/v1/soul/files/${encodeURIComponent(fileKey)}`, {
      method: "PUT",
      body: JSON.stringify({ content } satisfies UpdateSoulFileRequest),
    });
  }

  async writeProfileSoulFile(
    profileId: string,
    fileKey: string,
    content: string,
  ): Promise<void> {
    await this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/files/${encodeURIComponent(fileKey)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content } satisfies UpdateSoulFileRequest),
      },
    );
  }

  async getUserContext(
    options: { includeContent?: boolean } = {},
  ): Promise<UserContextStatusResponse> {
    const query = options.includeContent ? "?content=true" : "";
    return this.request<UserContextStatusResponse>(`/v1/user/context${query}`);
  }

  async writeUserContext(content: string): Promise<void> {
    await this.request("/v1/user/context", {
      method: "PUT",
      body: JSON.stringify({ content } satisfies UpdateUserContextRequest),
    });
  }

  async initUserContext(): Promise<InitUserContextResponse> {
    return this.request<InitUserContextResponse>("/v1/user/context/init", {
      method: "POST",
    });
  }

  createChatSession(sessionId: string, channel: AgentChannel): RemoteChatSession {
    return {
      id: sessionId,
      send: async (input: SendMessageArg) => {
        const body = resolveSendMessageBody(input);
        const response = await this.request<SendMessageResponse>(
          `/v1/sessions/${sessionId}/messages`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );

        return response.reply;
      },
      sendStream: async (
        input: SendMessageArg,
        handler: StreamHandler | StreamHandlers,
        options?: SendStreamOptions,
      ) => {
        const handlers = normalizeStreamHandlers(handler);
        const body = { ...resolveSendMessageBody(input), stream: true };
        const response = await this.fetchImpl(
          `${this.baseUrl}/v1/sessions/${sessionId}/messages?stream=true`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(body),
            signal: options?.signal,
          },
        );

        if (!response.ok) {
          throw await createApiError(response, `/v1/sessions/${sessionId}/messages`);
        }

        if (!response.body) {
          throw new Error("Server returned an empty stream.");
        }

        return readStreamEvents(response.body, handlers, options?.signal);
      },
      compact: async (options = {}) => {
        return this.request<CompactionResponse>(
          `/v1/sessions/${sessionId}/compact`,
          {
            method: "POST",
            body: JSON.stringify(options),
          },
        );
      },
      clear: async () => {
        await this.request(`/v1/sessions/${sessionId}`, {
          method: "DELETE",
        });
      },
      purge: async () => {
        await this.request(`/v1/sessions/${sessionId}?purge=true`, {
          method: "DELETE",
        });
      },
      getMessages: async () => {
        const response = await this.getSessionMessages(sessionId);
        return response.messages;
      },
      createAutomation: async (prompt: string) => {
        const response = await this.request<DraftAutomationResponse>(
          "/v1/automations/draft",
          {
            method: "POST",
            body: JSON.stringify({ prompt, channel }),
          },
        );

        return response.automation;
      },
    };
  }

  async draftAutomation(
    prompt: string,
    channel: AgentChannel,
  ): Promise<AutomationDefinition> {
    const response = await this.request<DraftAutomationResponse>(
      "/v1/automations/draft",
      {
        method: "POST",
        body: JSON.stringify({ prompt, channel }),
      },
    );

    return response.automation;
  }

  async listAutomations(): Promise<StoredAutomation[]> {
    const response = await this.request<ListAutomationsResponse>("/v1/automations");
    return response.automations;
  }

  async getAutomation(automationId: string): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`,
    );
    return response.automation;
  }

  async createAutomation(request: CreateAutomationRequest): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>("/v1/automations", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return response.automation;
  }

  async updateAutomation(
    automationId: string,
    request: UpdateAutomationRequest,
  ): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`,
      {
        method: "PUT",
        body: JSON.stringify(request),
      },
    );
    return response.automation;
  }

  async deleteAutomation(automationId: string): Promise<void> {
    await this.request(`/v1/automations/${encodeURIComponent(automationId)}`, {
      method: "DELETE",
    });
  }

  async runAutomation(automationId: string): Promise<AutomationRunRecord> {
    const response = await this.request<RunAutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/run`,
      { method: "POST" },
    );
    return response.run;
  }

  async listAutomationRuns(automationId: string): Promise<AutomationRunRecord[]> {
    const response = await this.request<ListAutomationRunsResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs`,
    );
    return response.runs;
  }

  async getTimezone(): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>("/v1/settings/timezone");
    return response.timezone;
  }

  async setTimezone(timezone: string): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>("/v1/settings/timezone", {
      method: "PUT",
      body: JSON.stringify({ timezone } satisfies UpdateTimezoneRequest),
    });
    return response.timezone;
  }

  async getTelegramSettings(): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram");
  }

  async setTelegramSettings(
    request: UpdateTelegramSettingsRequest,
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async regenerateTelegramHandshake(): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram/handshake", {
      method: "POST",
    });
  }

  async listTimezones(): Promise<ListTimezonesResponse> {
    return this.request<ListTimezonesResponse>("/v1/timezones");
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw await createApiError(response, path);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

async function readStreamEvents(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  const abortReader = () => {
    void reader.cancel();
  };

  signal?.addEventListener("abort", abortReader, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf("\n\n");

        if (boundary < 0) {
          break;
        }

        const eventBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of eventBlock.split("\n")) {
          if (!line.startsWith("data: ")) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as StreamEvent;

          if (payload.type === "chunk") {
            handlers.onChunk(payload.delta);
            reply += payload.delta;
          }

          if (payload.type === "tool_start") {
            handlers.onToolStart?.({
              toolCallId: payload.toolCallId,
              tool: payload.tool,
              input: payload.input,
            });
          }

          if (payload.type === "tool_end") {
            handlers.onToolEnd?.({
              toolCallId: payload.toolCallId,
              tool: payload.tool,
              result: payload.result,
            });
          }

          if (payload.type === "done") {
            return payload.reply;
          }

          if (payload.type === "error") {
            throw new Error(payload.error);
          }
        }
      }
    }

    if (signal?.aborted) {
      return reply;
    }

    if (!reply) {
      throw new Error("Stream ended without a response.");
    }

    return reply;
  } catch (error) {
    if (signal?.aborted) {
      return reply;
    }

    throw error;
  } finally {
    signal?.removeEventListener("abort", abortReader);
  }
}

function normalizeStreamHandlers(
  handler: StreamHandler | StreamHandlers,
): StreamHandlers {
  if (typeof handler === "function") {
    return { onChunk: handler };
  }

  return handler;
}

function resolveSendMessageBody(input: SendMessageArg): SendMessageInput {
  return typeof input === "string" ? { message: input } : input;
}

export function getProfileAvatarUrl(
  profile: Pick<ProfileSummary, "id" | "hasAvatar" | "updatedAt">,
): string | null {
  if (!profile.hasAvatar) {
    return null;
  }

  const query = new URLSearchParams({ v: profile.updatedAt });
  return `/v1/profiles/${encodeURIComponent(profile.id)}/avatar?${query.toString()}`;
}

export function createClient(options?: TinyClawClientOptions): TinyClawClient {
  return new TinyClawClient(options);
}

export function getServerUrl(): string {
  return resolveServerUrl();
}

export { formatClientError as formatError, TinyClawApiError } from "@tinyclaw/core/api-error";

async function createApiError(response: Response, path: string): Promise<TinyClawApiError> {
  const message = await readApiErrorMessage(response);
  return new TinyClawApiError(message, response.status, path);
}
